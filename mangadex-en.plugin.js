const UA = "HarborMangaApp/1.0 (harbor-tizen@github.io)";

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function stripHtml(value) {
  return cleanText(String(value || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'"));
}

function uniq(items, keyFn) {
  const seen = new Set();
  const out = [];
  for (const item of items || []) {
    if (!item) continue;
    const key = keyFn ? keyFn(item) : item;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

async function jsonGet(url, opts) {
  const headers = Object.assign({
    "User-Agent": UA,
    "user-agent": UA,
    "Accept": "application/json"
  }, (opts && opts.headers) || {});
  
  const res = await harbor.http(url, Object.assign({}, opts || {}, {
    responseType: "json",
    headers: headers,
    timeoutMs: 25000,
  }));
  if (res === null || res === undefined) throw new Error("Invalid JSON from " + url);
  return typeof res === "object" && "body" in res && typeof res.body === "object" ? res.body : res;
}

function getCoverUrl(manga) {
  if (!manga) return undefined;
  const rels = manga.relationships || [];
  for (const r of rels) {
    if (r.type === "cover_art" && r.attributes && r.attributes.fileName) {
      return "https://uploads.mangadex.org/covers/" + manga.id + "/" + r.attributes.fileName + ".512.jpg";
    }
  }
  return undefined;
}

function getMangaTitle(manga) {
  if (!manga || !manga.attributes || !manga.attributes.title) return "Manga";
  const t = manga.attributes.title;
  return t.en || t["ja-ro"] || t.ar || Object.values(t)[0] || "Manga";
}

async function popular(offset) {
  const off = Number(offset) || 0;
  const url = "https://api.mangadex.org/manga?limit=24&offset=" + off + "&order[followedCount]=desc&includes[]=cover_art&contentRating[]=safe&contentRating[]=suggestive";
  const data = await jsonGet(url);
  const items = (data && data.data) || [];
  return items.map(m => ({
    id: m.id,
    title: cleanText(getMangaTitle(m)),
    cover: getCoverUrl(m)
  }));
}

async function search(query, offset) {
  const off = Number(offset) || 0;
  const q = encodeURIComponent(cleanText(query || ""));
  const url = "https://api.mangadex.org/manga?limit=24&offset=" + off + "&title=" + q + "&includes[]=cover_art&contentRating[]=safe&contentRating[]=suggestive&contentRating[]=erotica";
  const data = await jsonGet(url);
  const items = (data && data.data) || [];
  return items.map(m => ({
    id: m.id,
    title: cleanText(getMangaTitle(m)),
    cover: getCoverUrl(m)
  }));
}

async function detail(id) {
  const url = "https://api.mangadex.org/manga/" + encodeURIComponent(id) + "?includes[]=cover_art&includes[]=author&includes[]=artist";
  const data = await jsonGet(url);
  const m = data && data.data;
  if (!m) throw new Error("Manga not found: " + id);
  
  const attrs = m.attributes || {};
  let description = "";
  if (attrs.description) {
    description = attrs.description.en || Object.values(attrs.description)[0] || "";
  }
  
  let author = undefined;
  for (const r of (m.relationships || [])) {
    if (r.type === "author" || r.type === "artist") {
      if (r.attributes && r.attributes.name) {
        author = r.attributes.name;
        break;
      }
    }
  }

  return {
    id: m.id,
    title: cleanText(getMangaTitle(m)),
    cover: getCoverUrl(m),
    description: stripHtml(description),
    author: author,
    status: attrs.status === "completed" ? "completed" : "ongoing"
  };
}

async function chapters(id) {
  let offset = 0;
  let allChapters = [];
  
  while (offset < 300) {
    const url = "https://api.mangadex.org/manga/" + encodeURIComponent(id) + "/feed?translatedLanguage[]=en&limit=100&offset=" + offset + "&order[chapter]=desc&order[volume]=desc";
    const data = await jsonGet(url);
    const list = (data && data.data) || [];
    if (!list.length) break;
    
    for (const ch of list) {
      const cAttrs = ch.attributes || {};
      if (cAttrs.externalUrl || cAttrs.pages === 0) continue;
      const num = cAttrs.chapter || "";
      const chTitle = cAttrs.title ? (": " + cAttrs.title) : "";
      allChapters.push({
        id: ch.id,
        chapter: num,
        title: "Ch. " + (num || "") + cleanText(chTitle),
        number: parseFloat(num) || 0
      });
    }
    
    if (list.length < 100) break;
    offset += 100;
  }
  
  const unique = uniq(allChapters, x => x.id);
  unique.sort((a, b) => (b.number || 0) - (a.number || 0));
  return unique;
}

async function pageUrls(chapterId) {
  const url = "https://api.mangadex.org/at-home/server/" + encodeURIComponent(chapterId);
  const data = await jsonGet(url);
  const baseUrl = data.baseUrl;
  const hash = data.chapter && data.chapter.hash;
  const pages = (data.chapter && data.chapter.data) || [];
  
  return pages.map(p => baseUrl + "/data/" + hash + "/" + p);
}

const plugin = {
  id: "mangadex-en",
  name: "MangaDex (English)",
  popular,
  search,
  detail,
  chapters,
  pageUrls
};

return plugin;
