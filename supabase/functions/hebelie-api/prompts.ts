// prompts.js — prompt builder for fal-ai/nano-banana/edit
// One shared PRESERVE block + per-treatment CHANGE text with light/medium intensity.

const PRESERVE = [
  "Keep everything else identical to the original photo:",
  "the person's identity, face shape and width, eye shape and size, nose, chin,",
  "expression, head pose and angle, skin tone, hair, hairline, facial hair, makeup,",
  "glasses, clothing, lighting, background and framing.",
  "Preserve natural skin texture with visible pores and fine detail.",
  "Do not smooth skin, whiten teeth, brighten eyes, retouch, beautify or apply any",
  "filter outside the treated area.",
].join(" ");

const STYLE =
  "Photorealistic, looks like an unedited photograph. Output the same image with only the described change. The change must be clearly noticeable when comparing the before and after images, while remaining photorealistic.";

const TREATMENTS = [
  {
    id: "lips",
    label: "Lip filler",
    surgical: false,
    area: "the lips only (upper and lower lip volume and border definition)",
    intensity: {
      light:
        "a clearly visible increase in lip volume, about 20%, a more defined lip border, keep the original lip shape, width and color",
      medium:
        "a strong increase in lip volume, about 35%, prominently defined lip border, noticeably fuller lips while keeping the original lip shape and width",
    },
    extra: "Do not change the mouth width, smile, teeth or lip color.",
  },
  {
    id: "cheeks",
    label: "Cheek filler",
    surgical: false,
    area: "the cheekbone and mid-cheek area only",
    intensity: {
      light: "a clearly visible lift and a noticeable gain of volume over the cheekbones",
      medium:
        "a strong, pronounced lift with a dramatic yet natural gain of volume over the cheekbones, sculpted youthful contour",
    },
    extra: "Do not change overall face width or the shape of the eyes.",
  },
  {
    id: "botox",
    label: "Botox",
    surgical: false,
    area: "wrinkle lines on the forehead, between the brows, and at the outer eye corners only",
    intensity: {
      light: "lines are visibly smoothed by about 60%, only faint traces remain",
      medium: "lines are almost completely erased, about 90%, an exceptionally smooth forehead and eye area",
    },
    extra:
      "Keep the exact same facial expression, brow position and eye shape. Do not lift or lower the brows.",
  },
  {
    id: "jawline",
    label: "Jawline contour",
    surgical: false,
    area: "the jawline and chin contour only",
    intensity: {
      light: "a clearly defined, sharper jawline edge",
      medium:
        "a sharply sculpted, chiseled jawline edge like a strong contouring filler result, still natural",
    },
    extra:
      "Keep the same face shape and width, do not make the jaw look more masculine, wider or squarer, do not change the chin position.",
  },
  {
    id: "skin",
    label: "Skin rejuvenation",
    surgical: false,
    area: "skin quality on the face only (tone, redness, fine lines)",
    intensity: {
      light: "visibly clearer and more even tone, clearly reduced redness, softened fine lines",
      medium:
        "dramatically clearer and more even tone, almost no redness, visibly softened fine lines",
    },
    extra:
      "Keep visible pores, freckles, moles, natural skin texture and natural skin color. Do not add glow, shine or airbrushed smoothness.",
  },
  {
    id: "browlift",
    label: "Brow lift",
    surgical: false,
    area: "the position of the eyebrows only",
    intensity: {
      light: "raise the brows by about 3 mm",
      medium: "raise the brows by about 5 mm",
    },
    extra:
      "Do not change the eyes, eyelids, eye shape or size, or the eyebrow shape and color. Keep the same expression.",
  },
  {
    id: "facelift",
    label: "Facelift",
    surgical: true, // consider hiding for a medspa-only product
    area: "the entire face, jawline and neck",
    intensity: {
      light:
        "visibly smoother, tighter skin across the whole face: softened jowls and nasolabial folds, mildly elevated cheeks, firmer jawline and neck",
      medium:
        "a clearly rejuvenated full-face lift: notably tighter skin, reduced jowls and sagging, elevated cheeks, defined jawline and a smoother neck, like a successful facelift result",
    },
    extra:
      "Keep the same person and natural proportions. Do not change the eyes, nose, mouth, hairline, expression or hairstyle beyond the lift effect.",
  },
  {
    id: "rhino",
    label: "Rhinoplasty",
    surgical: true, // highest identity-drift and body-image risk
    area: "the nose only",
    intensity: {
      light: "a noticeable but natural refinement of the nose tip and bridge",
      medium: "a clearly refined, slimmer nose tip and bridge with a more sculpted profile",
    },
    extra:
      "Keep the nose recognizably the same person's nose, same nostril width proportions and same facial balance.",
  },
];

function resolveTreatments(treatmentId, intensity) {
  const ids = Array.isArray(treatmentId) ? treatmentId : [treatmentId];
  if (!ids.length || ids.length > 3) {
    throw new Error("Choose 1 to 3 treatments");
  }
  return ids.map((id) => {
    const t = TREATMENTS.find((x) => x.id === id);
    if (!t) throw new Error(`Unknown treatment: ${id}`);
    const level = t.intensity[intensity];
    if (!level) throw new Error(`Unknown intensity: ${intensity}`);
    return { t, level };
  });
}

function buildPrompt(treatmentId, intensity = "light") {
  const treatments = resolveTreatments(treatmentId, intensity);

  if (treatments.length === 1) {
    const { t, level } = treatments[0];
    return [
      `Edit this photo to simulate the appearance after ${t.label.toLowerCase()}.`,
      `Only modify ${t.area}. Change: ${level}.`,
      t.extra,
      PRESERVE,
      STYLE,
    ].join("\n");
  }

  const names = treatments.map(({ t }) => t.label.toLowerCase());
  const joined =
    names.length === 2
      ? `${names[0]} and ${names[1]}`
      : `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;

  const changes = treatments.map(
    ({ t, level }, i) =>
      `${i + 1}. Only modify ${t.area}. Change: ${level}. ${t.extra}`
  );

  return [
    `Edit this photo to simulate the combined appearance after ${joined}.`,
    "Apply every change below together in a single edit. Keep each change inside its own area, and do not exaggerate beyond the described change.",
    ...changes,
    PRESERVE,
    STYLE,
  ].join("\n");
}

// Example request body for fal-ai/nano-banana/edit
// treatmentId may be one id or an array of 1–3 ids.
function buildRequest(treatmentId, intensity, imageDataUrl, numImages = 1) {
  return {
    prompt: buildPrompt(treatmentId, intensity),
    image_urls: [imageDataUrl],
    num_images: numImages, // use 2-3 while testing, 1 in production
    output_format: "jpeg",
  };
}

export { TREATMENTS, buildPrompt, buildRequest };
