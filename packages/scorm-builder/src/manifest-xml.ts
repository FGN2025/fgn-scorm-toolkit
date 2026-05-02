/**
 * SCORM 1.2 imsmanifest.xml generator.
 *
 * The manifest tells the LMS:
 *   - what schema/version this package targets (ADL SCORM 1.2)
 *   - the course identifier and version
 *   - the IMS LOM metadata (title, description, keywords, technical info)
 *   - the organization/item structure (we use a single SCO)
 *   - the resource (and every file inside it — SCORM 1.2 requires this)
 *
 * Validation target: SCORM Cloud (which is the strictest commonly-used
 * validator). Compatible with Moodle, Cornerstone, Workday Learning,
 * SAP SuccessFactors, and most enterprise LMSs.
 */

import type { CourseManifest } from '@fgn/course-types';

export interface GenerateManifestInput {
  course: CourseManifest;
  /** Every file path inside the ZIP, relative to the package root. */
  filePaths: string[];
  /** Mastery score 0..100. Defaults to 80. */
  masteryScore?: number;
  /** Typical learning time in ISO 8601 duration format (e.g. PT45M). Default: PT30M. */
  typicalLearningTime?: string;
}

export function generateManifestXml(input: GenerateManifestInput): string {
  const { course, filePaths } = input;
  const masteryScore = input.masteryScore ?? 80;
  const learningTime = input.typicalLearningTime ?? 'PT30M';

  // SCORM identifier must be a valid XML ID (no spaces, starts with letter).
  // Course IDs from the transformer are already in a safe form ("bundle-..."),
  // but defensively sanitize.
  const identifier = sanitizeXmlId(course.id);
  const orgIdentifier = `ORG-${identifier}`;
  const itemIdentifier = `ITEM-${identifier}`;
  const resIdentifier = `RES-${identifier}`;

  const fileTags = filePaths
    .map((p) => `      <file href="${escapeXml(p)}"/>`)
    .join('\n');

  const description = course.description ?? '';
  const keywords = buildKeywords(course);
  const keywordsXml = keywords
    .map(
      (k) => `        <imsmd:keyword>
          <imsmd:langstring xml:lang="en-US">${escapeXml(k)}</imsmd:langstring>
        </imsmd:keyword>`,
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="${identifier}" version="1.0"
          xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"
          xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2"
          xmlns:imsmd="http://www.imsglobal.org/xsd/imsmd_rootv1p2p1"
          xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
          xsi:schemaLocation="http://www.imsproject.org/xsd/imscp_rootv1p1p2 imscp_rootv1p1p2.xsd
                              http://www.imsglobal.org/xsd/imsmd_rootv1p2p1 imsmd_rootv1p2p1.xsd
                              http://www.adlnet.org/xsd/adlcp_rootv1p2 adlcp_rootv1p2.xsd">

  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>1.2</schemaversion>
    <imsmd:lom>
      <imsmd:general>
        <imsmd:identifier>${escapeXml(course.id)}</imsmd:identifier>
        <imsmd:title>
          <imsmd:langstring xml:lang="en-US">${escapeXml(course.title)}</imsmd:langstring>
        </imsmd:title>
        <imsmd:description>
          <imsmd:langstring xml:lang="en-US">${escapeXml(description)}</imsmd:langstring>
        </imsmd:description>
${keywordsXml}
      </imsmd:general>
      <imsmd:lifecycle>
        <imsmd:version>
          <imsmd:langstring xml:lang="en-US">1.0</imsmd:langstring>
        </imsmd:version>
        <imsmd:status>
          <imsmd:source>
            <imsmd:langstring xml:lang="x-none">LOMv1.0</imsmd:langstring>
          </imsmd:source>
          <imsmd:value>
            <imsmd:langstring xml:lang="x-none">final</imsmd:langstring>
          </imsmd:value>
        </imsmd:status>
      </imsmd:lifecycle>
      <imsmd:technical>
        <imsmd:format>text/html</imsmd:format>
      </imsmd:technical>
      <imsmd:educational>
        <imsmd:typicallearningtime>
          <imsmd:datetime>${escapeXml(learningTime)}</imsmd:datetime>
        </imsmd:typicallearningtime>
      </imsmd:educational>
    </imsmd:lom>
  </metadata>

  <organizations default="${orgIdentifier}">
    <organization identifier="${orgIdentifier}">
      <title>${escapeXml(course.title)}</title>
      <item identifier="${itemIdentifier}" identifierref="${resIdentifier}">
        <title>${escapeXml(course.title)}</title>
        <adlcp:masteryscore>${masteryScore}</adlcp:masteryscore>
      </item>
    </organization>
  </organizations>

  <resources>
    <resource identifier="${resIdentifier}" type="webcontent" adlcp:scormtype="sco" href="index.html">
${fileTags}
    </resource>
  </resources>

</manifest>
`;
}

function buildKeywords(course: CourseManifest): string[] {
  const k: string[] = [];
  if (course.credentialFramework) k.push(course.credentialFramework);
  if (course.pillar) k.push(`pillar:${course.pillar}`);
  for (const m of course.modules) {
    if (m.type === 'challenge') {
      if (m.game) k.push(`game:${m.game}`);
      if (m.credentialFramework && m.credentialFramework !== course.credentialFramework) {
        k.push(m.credentialFramework);
      }
    }
  }
  // Dedupe.
  return Array.from(new Set(k));
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function sanitizeXmlId(s: string): string {
  // XML IDs must start with letter or underscore, no spaces, no special chars.
  let id = s.replace(/[^A-Za-z0-9._-]/g, '-');
  if (!/^[A-Za-z_]/.test(id)) id = `id-${id}`;
  return id;
}
