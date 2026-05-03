/**
 * Cover image prompt — generates a photoreal, cinematic, machinery-led
 * scene that matches the real FGN brand visual language used on
 * play.fgn.gg challenge cards and the fgn.academy hero.
 *
 * v4 — calibrated against actual FGN production imagery (May 2026).
 *
 * Reference: the user provided four screenshots showing live brand
 * images — Construction Sim challenge grid, Farming Sim challenge
 * grid, ATS challenge grid, fgn.academy "Master Fiber Optics" hero.
 * Synthesizing what they share:
 *
 *   1. PHOTOREAL or photoreal-painterly. Looks like a cinematic
 *      photograph or a high-end concept-art render. NOT stylized
 *      illustration, NOT cartoon, NOT vector.
 *
 *   2. Workers WELCOME in the frame. Hi-vis vests, hardhats, gloves,
 *      eye protection. They are caught mid-task — surveying with
 *      tablets, signaling cranes, splicing fiber, climbing into cabs.
 *      Faces are often partially obscured by hardhats, side angles, or
 *      attention focused downward at the work. NEVER posed at-camera.
 *      NEVER stock-photo "happy worker shaking hands" energy.
 *
 *   3. Natural time-of-day lighting drives the mood. Golden hour,
 *      dusk, dawn, stormy skies, sodium-vapor work lights at night.
 *      The brand's UI mode (arcade vs enterprise) is for HTML chrome
 *      surrounding the image — it does NOT impose a cyan or violet
 *      filter on the image itself. Production cards span the full
 *      lighting spectrum.
 *
 *   4. Equipment in CONTEXT. Real worksites — dirt and rebar, fields
 *      with crops, highways with traffic lines, utility poles with
 *      cables. Equipment never floats in abstract dark space.
 *
 *   5. In-game HUD overlays are part of the brand. Color-coded
 *      grading maps, soil sampling indicators, GPS overlays, dash
 *      tablets. These are scene-appropriate visual elements — NOT
 *      forbidden as "data visualizations." They distinguish FGN
 *      sim-derived training from generic stock work imagery.
 *
 *   6. Brand chrome lives in the HTML overlay (game label badge,
 *      difficulty pill, course title in Orbitron, FGN wordmark) —
 *      NOT in the image. So: NO TEXT in the image.
 *
 * Adding a new game = add one line to GAME_SCENES. No code change.
 */

import type { CourseManifest, GameTitle } from '@fgn/course-types';

/**
 * Per-game scene menus. Each scene reflects what an actual FGN card
 * for that game looks like in production. Workers may appear, HUD
 * overlays may appear, lighting varies by scenario.
 */
const GAME_SCENES: Record<GameTitle, string> = {
  ATS:
    'a Class 8 American semi-truck in real working context — could be highway at dusk with mountain silhouettes, a stormy mountain pass, a dock yard under sodium-vapor work lights, or a rest stop at dawn. Three-quarter angle on the truck. The driver may appear in cab profile (hands on wheel, partial face obscured) or doing a pre-trip inspection with clipboard in proper hi-vis vest — never posed at camera. Real CDL-relevant detail: load straps, mud flaps, DOT signage, road shoulder geometry, weigh station context. Photoreal cinematic.',
  Farming_Sim:
    'modern agricultural equipment in real field context — combine harvester crossing a vibrant golden wheat or corn field, large tractor with planter or seeder kicking up dust, applicator spraying with precision-ag GPS overlay, or grain truck at the elevator. Time of day varies (golden hour, dawn, after a rain). May include in-game HUD overlay — Precision Farming yield map, soil-pH zone visualization, nitrogen-status colors — as a scene-appropriate technological element. Operator may appear in cab profile or with a tablet in hi-vis vest, hardhat, or cap. Photoreal cinematic agriculture.',
  Construction_Sim:
    'heavy civil construction equipment on an active worksite — choose one specific scenario: a yellow hydraulic excavator mid-dig with rebar and dirt visible, a bulldozer grading with the in-game green/red Construction View color overlay on the ground, a wheel loader pouring into a CAT articulated dump truck, a road paver mid-pass at night with sodium-vapor lights and a paving crew in hi-vis, a mobile crane lifting a beam under a stormy sky, a concrete pump placing concrete on a high-rise deck, or a demolition rig with fire-glow and dust. Workers in proper PPE (hardhats, hi-vis, eye protection) may be present, caught mid-task with attention on their work — never posed. Photoreal cinematic. Time of day matches the scenario.',
  Mechanic_Sim:
    'an automotive workshop scene — a meticulously detailed engine bay viewed from above with valve cover off and intake manifold visible under bright shop lights, OR a car on a lift with a mechanic working underneath caught from a low angle (boots and gloved hands visible, face obscured by the chassis), OR a precision diagnostic scene with OBD-II tools and the laptop showing live data. Tools, oil sheen, work lights, organized clutter of a real shop. Photoreal cinematic.',
  Roadcraft:
    'a heavy off-road recovery rig — articulated hauler, mud-spattered recovery winch truck, or amphibious crane — moving through a rugged storm-cleared landscape. Wet earth, partially restored infrastructure (downed poles, washed-out road), overcast natural lighting with breaking sunlight. Operator visible in cab profile (face obscured by hardhat or focus on controls) or signaling another rig — proper PPE, mid-task. Photoreal cinematic disaster-recovery feel.',
  Fiber_Tech:
    'a fiber-optic technician at work in real broadband infrastructure context — kneeling at the base of a utility pole splicing fiber on a portable fusion splicer at golden hour, or in a bucket truck securing a strand under sunset light, or running cables out of a fiber spool truck. Worker is in proper PPE (hi-vis, hardhat, eye protection, gloves) and the focus is on the work and equipment — fiber strands, splicer screen, optical test meter — not on the worker as a portrait. Real broadband details: utility pole hardware, bucket truck boom, fiber spools, OTDR equipment. Photoreal cinematic — matches the established fgn.academy hero aesthetic.',
};

/**
 * Default scene used when the course has no recognizable game (rare —
 * mostly for hand-authored courses that bypass transform()).
 */
const FALLBACK_SCENE =
  'a single hero piece of vocational equipment in real working context — heavy industrial machinery, fleet vehicle, or precision tool — under cinematic natural lighting. A worker in proper PPE may be present, caught mid-task. Photoreal cinematic.';

export interface CoverImagePrompt {
  /** Composed text prompt to send to the image model. */
  prompt: string;
}

export function buildCoverImagePrompt(
  course: CourseManifest,
  game: GameTitle | undefined,
): CoverImagePrompt {
  // Phase 1.4.5.1 — if the manifest carries a per-challenge override
  // (sourced from play.fgn.gg's `cover_image_prompt` field at transform
  // time), use it as the SCENE description in place of the game-default
  // scene. This lets the FGN content team curate per-challenge image
  // direction without bypassing the brand framing — we still wrap the
  // override scene in the FGN photoreal/people/composition/lighting/
  // hard-constraints structure.
  const scene = course.coverImagePromptOverride
    ?? (game ? GAME_SCENES[game] : FALLBACK_SCENE);
  // Note: course.brandMode is intentionally NOT used to drive image
  // grading. Brand mode controls UI surface color (dark vs light) and
  // HTML chrome around the image — production FGN imagery uses natural
  // time-of-day lighting regardless of which surface the image is
  // ultimately placed on. See the reference cards on play.fgn.gg.
  const frameworkHint = course.credentialFramework
    ? ` Hint at ${course.credentialFramework} professional context — subtle environmental cues only, no literal logos or framework names visible.`
    : '';

  // Order: aesthetic register → people rule → scene → cinematography →
  // hard constraints. The aesthetic register comes first because it's
  // the most-violated dimension (gpt-image models default toward
  // stylized illustration without explicit photoreal direction).
  const lines = [
    'A cinematic vocational-training cover image for the FGN Skill Passport learning platform.',
    'AESTHETIC: photoreal cinematic photograph or photoreal painted concept-art. NOT stylized illustration, NOT cartoon, NOT vector graphic, NOT 3D-render-product-shot. Looks like a frame from a documentary feature or a high-end editorial photograph of vocational work.',
    'PEOPLE RULE: workers may appear in the frame, but only when caught mid-task in proper PPE (hi-vis vest, hardhat, gloves, eye protection as appropriate to the trade). Faces are often obscured by hardhats, side angles, or attention focused on the work. NEVER posed at the camera. NEVER stock-photo "happy worker" energy. NEVER a portrait headshot. The work being done must look real and recognizable to a tradesperson in the field.',
    'COMPOSITION: machinery-led — the equipment is the dominant subject (60-70% of the frame). Three-quarter angle, low or eye-level camera, single strong focal point. Worker if present is supporting cast, not center of attention.',
    `SCENE: ${scene}`,
    'LIGHTING: natural time-of-day lighting drives the mood. Golden hour, dusk, dawn, stormy daylight, sodium-vapor night work, magic hour — match the scene. Hard directional light source. Atmospheric haze where it fits (dust, rain, exhaust, fog). NEVER apply a brand-color filter overlay; the lighting carries the emotional tone.',
    'ACTION: the machine is mid-task, not posed. Bucket descending, hydraulics under load, dust rising, exhaust haze, water spray, sparks settling, wheels turning. Movement is implied, not frozen.',
    'IN-GAME HUD: scene-appropriate in-game HUD or overlay elements ARE allowed when they fit the scenario — color-coded grading maps for Construction Simulator, GPS yield maps for Farming Simulator, dashboard tablets for any sim. These are FGN brand-relevant visual elements, NOT generic data dashboards. They look like the actual sim UI, not stock business charts.',
    `${frameworkHint.trim()}`,
    'Hard constraints (do not violate): NO TEXT of any kind. NO LETTERING. NO LOGOS. NO SIGNAGE WITH READABLE WORDS. NO WATERMARKS. NO COPYRIGHTED BRAND MARKINGS. NO GENERIC INDUSTRY-4.0 OR FUTURISTIC-FACTORY AESTHETIC. NO STOCK BUSINESS CHARTS or floating data abstractions. NO HUMAN PORTRAITS WITH DIRECT EYE CONTACT TO CAMERA. The image must work alongside HTML-rendered titles, badges, and the FGN wordmark laid over it by the player UI.',
    'Avoid: cliché business handshake imagery, polished stock-photo look, generic "happy crew" energy, AI-tells like extra fingers or melted typography or warped equipment geometry.',
  ];
  return { prompt: lines.filter((l) => l.length > 0).join(' ') };
}
