import type { AssetRef, Character, Comment, Episode, Fact, JobState, Profile, Pronunciation, Show } from "../../shared/types";

export interface Version {
  id: string;
  note: string;
  createdAt: string;
  episode: Episode;
}

export interface DataStore {
  readonly mode: "supabase" | "local";

  // ---- auth
  currentUser(): Promise<Profile | null>;
  signIn(email: string, password: string): Promise<void>;
  sendMagicLink(email: string): Promise<void>;
  sendPasswordReset(email: string): Promise<void>;
  updatePassword(password: string): Promise<void>;
  signOut(): Promise<void>;
  onAuthChange(cb: (event?: string) => void): () => void;
  /** Bearer token for the server functions. */
  token(): Promise<string | null>;

  // ---- show content
  getShow(id: string): Promise<Show | null>;
  listShows(): Promise<Show[]>;
  saveShow(show: Show): Promise<void>;
  listCharacters(showId: string): Promise<Character[]>;
  saveCharacter(c: Character): Promise<void>;
  deleteCharacter(id: string): Promise<void>;
  listPronunciations(showId: string): Promise<Pronunciation[]>;
  savePronunciation(showId: string, p: Pronunciation): Promise<void>;
  deletePronunciation(id: string): Promise<void>;
  listFacts(showId: string): Promise<Fact[]>;
  saveFact(showId: string, f: Fact): Promise<void>;
  deleteFact(id: string): Promise<void>;
  listAssets(showId: string): Promise<AssetRef[]>;
  saveAsset(showId: string, a: AssetRef): Promise<void>;
  deleteAsset(id: string): Promise<void>;

  // ---- episodes
  listEpisodes(showId: string): Promise<Episode[]>;
  getEpisode(id: string): Promise<Episode | null>;
  saveEpisode(ep: Episode): Promise<void>;
  deleteEpisode(id: string): Promise<void>;
  snapshot(ep: Episode, note: string): Promise<void>;
  listVersions(episodeId: string): Promise<Version[]>;
  listComments(episodeId: string): Promise<Comment[]>;
  saveComment(c: Comment): Promise<void>;
  deleteComment(id: string): Promise<void>;
  getJob(id: string): Promise<JobState | null>;

  // ---- files
  upload(path: string, file: Blob, contentType?: string): Promise<string>;
  /** A URL the browser can fetch (signed for Supabase, object URL locally). */
  fileUrl(path: string): Promise<string>;
  download(path: string): Promise<Blob>;
  remove(path: string): Promise<void>;
}
