import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";

export async function loadFixture(name) {
  const html = await readFile(new URL(`fixtures/${name}`, import.meta.url), "utf8");
  return new JSDOM(html, { url: "https://app.catchtable.co.kr/ct/shop/kea?date=260730" });
}
