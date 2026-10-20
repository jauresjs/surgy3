import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export type Treatment = {
  id: string;
  label: string;
  area: string;
  intensity: Record<string, string>;
  extra: string;
};

type Catalog = {
  treatments: Treatment[];
  preserve: string;
  style: string;
};

let catalogCache: Catalog | null = null;

export async function loadPromptCatalog(supabase: SupabaseClient): Promise<Catalog> {
  if (catalogCache) return catalogCache;
  const { data, error } = await supabase.from("private_settings").select("value").eq("key", "prompt_catalog").maybeSingle();
  if (error || !data?.value) throw new Error("Preview prompts are not configured");
  catalogCache = JSON.parse(data.value) as Catalog;
  if (!catalogCache.treatments?.length) throw new Error("Preview prompts are not configured");
  return catalogCache;
}

function resolveTreatments(catalog: Catalog, treatmentId: string | string[], intensity: string) {
  const ids = Array.isArray(treatmentId) ? treatmentId : [treatmentId];
  if (!ids.length || ids.length > 3) throw new Error("Choose 1 to 3 treatments");
  return ids.map((id) => {
    const t = catalog.treatments.find((x) => x.id === id);
    if (!t) throw new Error(`Unknown treatment: ${id}`);
    const level = t.intensity[intensity];
    if (!level) throw new Error(`Unknown intensity: ${intensity}`);
    return { t, level };
  });
}

export function buildPrompt(catalog: Catalog, treatmentId: string | string[], intensity = "light") {
  const treatments = resolveTreatments(catalog, treatmentId, intensity);

  if (treatments.length === 1) {
    const { t, level } = treatments[0];
    return [
      `Edit this photo to simulate the appearance after ${t.label.toLowerCase()}.`,
      `Only modify ${t.area}. Change: ${level}.`,
      t.extra,
      catalog.preserve,
      catalog.style,
    ].join("\n");
  }

  const names = treatments.map(({ t }) => t.label.toLowerCase());
  const joined =
    names.length === 2
      ? `${names[0]} and ${names[1]}`
      : `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;

  const changes = treatments.map(
    ({ t, level }, i) => `${i + 1}. Only modify ${t.area}. Change: ${level}. ${t.extra}`,
  );

  return [
    `Edit this photo to simulate the combined appearance after ${joined}.`,
    "Apply every change below together in a single edit. Keep each change inside its own area, and do not exaggerate beyond the described change.",
    ...changes,
    catalog.preserve,
    catalog.style,
  ].join("\n");
}

export function buildRequest(
  catalog: Catalog,
  treatmentId: string | string[],
  intensity: string,
  imageDataUrl: string,
  numImages = 1,
) {
  return {
    prompt: buildPrompt(catalog, treatmentId, intensity),
    image_urls: [imageDataUrl],
    num_images: numImages,
    output_format: "jpeg",
  };
}

export function labelsFor(catalog: Catalog, ids: string[]) {
  return ids.map((id) => catalog.treatments.find((t) => t.id === id)?.label || id);
}

export function normalizeTreatmentIds(catalog: Catalog, ids: unknown) {
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 3) throw new Error("Choose 1 to 3 treatments");
  const clean = ids.map((id) => String(id));
  if (new Set(clean).size !== clean.length) throw new Error("Choose each treatment once");
  for (const id of clean) {
    if (!catalog.treatments.some((t) => t.id === id)) throw new Error("Unknown treatment");
  }
  return clean;
}
