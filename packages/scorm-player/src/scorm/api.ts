/**
 * SCORM 1.2 API adapter.
 *
 * The LMS injects an `API` object somewhere in the window hierarchy. The
 * standard discovery pattern walks up `window.parent` and across
 * `window.opener` looking for it. Once found, all SCORM data flows
 * through that single object.
 *
 * If no API is found (e.g. running locally or in a previewer), this
 * adapter falls back to a console-logging stub so development still
 * works. The Player keeps functioning either way — completion just
 * doesn't get reported anywhere real.
 */

import type { ScormLessonStatus } from '../types';

interface Scorm12Api {
  LMSInitialize(empty: ''): 'true' | 'false';
  LMSFinish(empty: ''): 'true' | 'false';
  LMSGetValue(element: string): string;
  LMSSetValue(element: string, value: string): 'true' | 'false';
  LMSCommit(empty: ''): 'true' | 'false';
  LMSGetLastError(): string;
  LMSGetErrorString(code: string): string;
  LMSGetDiagnostic(code: string): string;
}

const API_DISCOVERY_DEPTH = 7;

function findApiInWindow(win: Window | null): Scorm12Api | null {
  if (!win) return null;
  const candidate = (win as unknown as { API?: Scorm12Api }).API;
  return candidate ?? null;
}

function discoverApi(): Scorm12Api | null {
  if (typeof window === 'undefined') return null;

  let win: Window | null = window;
  for (let i = 0; i < API_DISCOVERY_DEPTH && win; i++) {
    const api = findApiInWindow(win);
    if (api) return api;
    if (win.parent && win.parent !== win) {
      win = win.parent;
    } else {
      break;
    }
  }
  if (window.opener) {
    return findApiInWindow(window.opener);
  }
  return null;
}

class ScormStub implements Scorm12Api {
  private values: Record<string, string> = {
    'cmi.core.lesson_status': 'not attempted',
    'cmi.core.score.raw': '',
    'cmi.suspend_data': '',
    'cmi.core.student_id': 'preview-student',
    'cmi.core.student_name': 'Preview, Student',
  };
  private error = '0';

  LMSInitialize(): 'true' {
    console.info('[scorm-stub] LMSInitialize');
    return 'true';
  }
  LMSFinish(): 'true' {
    console.info('[scorm-stub] LMSFinish', this.values);
    return 'true';
  }
  LMSGetValue(element: string): string {
    return this.values[element] ?? '';
  }
  LMSSetValue(element: string, value: string): 'true' {
    console.info('[scorm-stub] LMSSetValue', element, value);
    this.values[element] = value;
    return 'true';
  }
  LMSCommit(): 'true' {
    console.info('[scorm-stub] LMSCommit', this.values);
    return 'true';
  }
  LMSGetLastError(): string {
    return this.error;
  }
  LMSGetErrorString(): string {
    return '';
  }
  LMSGetDiagnostic(): string {
    return '';
  }
}

export class ScormSession {
  private api: Scorm12Api;
  readonly isReal: boolean;
  private initialized = false;

  constructor() {
    const discovered = discoverApi();
    if (discovered) {
      this.api = discovered;
      this.isReal = true;
    } else {
      this.api = new ScormStub();
      this.isReal = false;
      console.warn(
        '[scorm-player] No SCORM API found in parent window — running in preview/standalone mode.',
      );
    }
  }

  initialize(): boolean {
    const ok = this.api.LMSInitialize('') === 'true';
    this.initialized = ok;
    return ok;
  }

  finish(): boolean {
    if (!this.initialized) return false;
    const ok = this.api.LMSFinish('') === 'true';
    this.initialized = false;
    return ok;
  }

  get(element: string): string {
    return this.api.LMSGetValue(element);
  }

  set(element: string, value: string): boolean {
    return this.api.LMSSetValue(element, value) === 'true';
  }

  commit(): boolean {
    return this.api.LMSCommit('') === 'true';
  }

  setLessonStatus(status: ScormLessonStatus): void {
    this.set('cmi.core.lesson_status', status);
    this.commit();
  }

  setScore(raw: number, max = 100, min = 0): void {
    this.set('cmi.core.score.raw', String(Math.round(raw)));
    this.set('cmi.core.score.max', String(max));
    this.set('cmi.core.score.min', String(min));
    this.commit();
  }

  setSuspendData(data: unknown): void {
    const json = JSON.stringify(data);
    if (json.length > 4096) {
      console.warn(
        `[scorm-player] suspend_data exceeds SCORM 1.2 4KB limit (${json.length} chars). Will be truncated by some LMSs.`,
      );
    }
    this.set('cmi.suspend_data', json);
    this.commit();
  }

  getSuspendData<T>(fallback: T): T {
    const raw = this.get('cmi.suspend_data');
    if (!raw) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }

  getStudentId(): string {
    return this.get('cmi.core.student_id');
  }

  getStudentName(): string {
    return this.get('cmi.core.student_name');
  }
}
