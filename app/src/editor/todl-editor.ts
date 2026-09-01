import { registerTodlLanguage } from "./todl-monarch.js";
import { TodlLanguageClient } from "./todl-language-client.js";

let client: TodlLanguageClient | undefined;

/** Register the TODL language + start the shared language-server Web Worker +
 *  register Monaco providers. Idempotent; returns the singleton client. */
export function initTodlEditor(): TodlLanguageClient {
  if (client === undefined) {
    registerTodlLanguage();
    client = new TodlLanguageClient();
    client.registerProviders();
  }
  return client;
}
