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
  return t.ar || t.en || t["ja-ro"] || Object.values(t)[0] || "Manga";
}

const TOP_ARABIC_MANGA = [
  "a1c7c817-4e59-43b7-9365-09675a149a6f", // One Piece
  "68112dc1-2b80-4f20-beb8-2f2a8716a430", // Dandadan
  "d1a9fdeb-f713-407f-960c-8326b586e6fd", // One Punch-Man
  "801513ba-a712-498b-8f57-0e521819a78e", // Berserk
  "a77742b1-d30d-440b-ac8f-96ced5681a2f", // Chainsaw Man
  "5de941bb-4d52-4894-97d5-820d94ca6ff9", // Tokyo Revengers
  "b8faa8ab-cb4e-416f-829d-d2a6042ba5ac", // Kingdom
];

async function popular(offset) {
  const off = Number(offset) || 0;
  
  if (off === 0) {
    try {
      const chUrl = "https://api.mangadex.org/chapter?translatedLanguage[]=ar&limit=60&order[readableAt]=desc&includes[]=manga";
      const chData = await jsonGet(chUrl);
      const mIds = [...TOP_ARABIC_MANGA];
      
      for (const ch of (chData && chData.data) || []) {
        if (ch.attributes && ch.attributes.pages > 0 && !ch.attributes.externalUrl) {
          const mRel = (ch.relationships || []).find(r => r.type === "manga");
          if (mRel && !mIds.includes(mRel.id)) {
            mIds.push(mRel.id);
          }
        }
      }
      
      const queryIds = mIds.slice(0, 30);
      const url = "https://api.mangadex.org/manga?ids[]=" + queryIds.join("&ids[]=") + "&includes[]=cover_art";
      const data = await jsonGet(url);
      const items = (data && data.data) || [];
      if (items.length > 0) {
        return items.map(m => ({
          id: m.id,
          title: cleanText(getMangaTitle(m)),
          cover: getCoverUrl(m)
        }));
      }
    } catch (_) {}
  }
  
  const url = "https://api.mangadex.org/manga?limit=24&offset=" + off + "&availableTranslatedLanguage[]=ar&order[followedCount]=desc&includes[]=cover_art";
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
  const q = cleanText(query);
  const url = "https://api.mangadex.org/manga?limit=24&offset=" + off + "&title=" + encodeURIComponent(q) + "&availableTranslatedLanguage[]=ar&order[relevance]=desc&includes[]=cover_art";
  const data = await jsonGet(url);
  const items = (data && data.data) || [];
  return items.map(m => ({
    id: m.id,
    title: cleanText(getMangaTitle(m)),
    cover: getCoverUrl(m)
  }));
}

async function detail(id) {
  const url = "https://api.mangadex.org/manga/" + encodeURIComponent(id) + "?includes[]=cover_art&includes[]=author";
  const data = await jsonGet(url);
  const m = data && data.data;
  if (!m) throw new Error("Manga not found: " + id);
  
  const attrs = m.attributes || {};
  const descObj = attrs.description || {};
  const description = descObj.ar || descObj.en || Object.values(descObj)[0] || "";
  
  return {
    id: m.id,
    title: cleanText(getMangaTitle(m)),
    cover: getCoverUrl(m),
    description: stripHtml(description),
    status: attrs.status === "completed" ? "completed" : "ongoing"
  };
}

async function chapters(id) {
  let offset = 0;
  let allChapters = [];
  
  // Try Arabic chapters first
  while (offset < 300) {
    const url = "https://api.mangadex.org/manga/" + encodeURIComponent(id) + "/feed?translatedLanguage[]=ar&limit=100&offset=" + offset + "&order[chapter]=desc&order[volume]=desc";
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
        title: "الفصل " + (num || "") + cleanText(chTitle),
        number: parseFloat(num) || 0
      });
    }
    
    if (list.length < 100) break;
    offset += 100;
  }
  
  // If no Arabic chapters, fall back to English chapters
  if (allChapters.length === 0) {
    offset = 0;
    while (offset < 200) {
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
          title: "Ch. " + (num || "") + cleanText(chTitle) + " [EN]",
          number: parseFloat(num) || 0
        });
      }
      
      if (list.length < 100) break;
      offset += 100;
    }
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
  id: "mangadex-ar",
  name: "مانجا دكس (MangaDex - عربي)",
  popular,
  search,
  detail,
  chapters,
  pageUrls
};

return plugin;
