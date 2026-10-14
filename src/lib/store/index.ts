import { LocalStore } from "./local";
import { SupabaseStore } from "./supabase";
import type { DataStore } from "./types";
import { DEFAULT_SHOW_ID, defaultCharacters, defaultFacts, defaultPronunciations, defaultShow } from "../../shared/defaults";
import sample from "../../shared/sampleEpisode.json";
import type { Episode } from "../../shared/types";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const store: DataStore = url && anon ? new SupabaseStore(url, anon) : new LocalStore();

/** First run: create The Bridge with its default cast, pronunciations, facts and the sample episode. */
export async function ensureSeed(s: DataStore = store): Promise<void> {
  const existing = await s.getShow(DEFAULT_SHOW_ID);
  if (existing) return;
  const show = defaultShow();
  await s.saveShow(show);
  await Promise.all(defaultCharacters(show.id).map((c) => s.saveCharacter(c)));
  await Promise.all(defaultPronunciations().map((p) => s.savePronunciation(show.id, p)));
  await Promise.all(defaultFacts().map((f) => s.saveFact(show.id, f)));
  await s.saveEpisode(structuredClone(sample) as unknown as Episode);
}

export type { DataStore };
