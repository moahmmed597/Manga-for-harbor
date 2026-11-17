const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36";

function pageFromOffset(offset) {
  return Math.floor((Number(offset) || 0) / 24) + 1;
}

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

function abs(base, value) {
  if (!value) return undefined;
  let url = cleanText(value).split(/\s+/)[0];
  if (!url || url.startsWith("data:")) return undefined;
  try { return new URL(url, base).toString(); } catch (_) { return undefined; }
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

async function text(url, opts) {
  const res = await harbor.http(url, Object.assign({
    responseType: "text",
    headers: {
      "user-agent": UA,
      "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8"
    },
    timeoutMs: 25000,
  }, opts || {}));
  if (!res || !res.ok) throw new Error("HTTP " + (res ? res.status : "?") + " for " + url);
  return typeof res === "string" ? res : (res.body || "");
}

const BASE = "https://mangatuk.com";
let sitemapCache = null;

async function getSitemap() {
  if (sitemapCache && sitemapCache.length > 0) return sitemapCache;
  try {
    const xml = await text(BASE + "/sitemaps/series/0");
    const matches = Array.from(xml.matchAll(/<loc>https:\/\/mangatuk\.com\/series\/([^<]+)<\/loc>/g)).map(m => m[1]);
    if (matches && matches.length > 0) {
      sitemapCache = matches;
      return sitemapCache;
    }
  } catch (_) {}
  return [];
}

async function popular(offset) {
  const off = Number(offset) || 0;
  
  if (off === 0) {
    const html = await text(BASE);
    const out = [];
    
    // 1. Escaped JSON from Next.js payload
    const jsonMatches = Array.from(html.matchAll(/\\\"slug\\\":\\\"([^\\\"]+)\\\"[^}]*?\\\"title\\\":\\\"([^\\\"]+)\\\"[^}]*?\\\"coverImage\\\":\\\"([^\\\"]+)\\\"/g));
    for (const m of jsonMatches) {
      out.push({
        id: m[1],
        title: cleanText(m[2]),
        cover: m[3]
      });
    }
    
    // 2. Featured slider articles
    const sliderMatches = Array.from(html.matchAll(/aria-label=["'](?:افتح\s+)?([^"']+)["']\s+href=["']\/series\/([^"']+)["'][\s\S]*?<img[^>]+src=["'](https:\/\/content\.mangatuk\.com\/axis\/covers\/[^"']+)["']/g));
    for (const m of sliderMatches) {
      out.push({
        id: m[2],
        title: cleanText(m[1]),
        cover: m[3]
      });
    }
    
    // 3. Grid cards
    const cardMatches = Array.from(html.matchAll(/href=["']\/series\/([^"']+)["'][\s\S]*?<h3[^>]*class=["'][^"']*app-series-card-title[^"']*["'][^>]*title=["']([^"']+)["']/g));
    for (const m of cardMatches) {
      out.push({
        id: m[1],
        title: cleanText(m[2]),
        cover: undefined
      });
    }
    
    const unique = uniq(out, x => x.id);
    if (unique.length > 0) return unique;
  }
  
  // Sitemaps pagination for offset > 0 or fallback
  const allSlugs = await getSitemap();
  const slice = allSlugs.slice(off, off + 24);
  return slice.map(slug => ({
    id: slug,
    title: cleanText(slug.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase())),
    cover: undefined
  }));
}

async function search(query, offset) {
  const q = cleanText(query).toLowerCase().replace(/\s+/g, "-");
  const allSlugs = await getSitemap();
  const matched = allSlugs.filter(slug => slug.toLowerCase().includes(q));
  const off = Number(offset) || 0;
  const slice = matched.slice(off, off + 24);
  return slice.map(slug => ({
    id: slug,
    title: cleanText(slug.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase())),
    cover: undefined
  }));
}

async function detail(id) {
  const slug = String(id).replace(/^\/series\//, "").replace(/\/$/, "");
  const url = BASE + "/series/" + slug;
  const html = await text(url);
  
  // Title
  let title = slug.replace(/-/g, " ");
  const tm = html.match(/<title>([^<]+)<\/title>/i);
  if (tm) {
    title = cleanText(tm[1].replace(/\|.*$/i, "").replace(/مانجاتك/g, "").replace(/مانهوا كورية/g, "").replace(/اقرأ/g, ""));
  }
  
  // Cover
  let cover = undefined;
  const cm = html.match(/https:\/\/content\.mangatuk\.com\/axis\/covers\/[^\s"'<>]+\.webp/i)
    || html.match(/<meta[^>]+(?:property="og:image"|name="twitter:image")[^>]+content=["']([^"']+)["']/i);
  if (cm) cover = cm[1] || cm[0];
  
  // Description
  let description = undefined;
  const dm = html.match(/<meta[^>]+(?:property="og:description"|name="description")[^>]+content=["']([^"']+)["']/i);
  if (dm) description = stripHtml(dm[1]);
  
  return {
    id: slug,
    title: title || slug,
    cover,
    description: description || undefined,
    status: html.includes("مستمرة") ? "ongoing" : (html.includes("مكتملة") ? "completed" : undefined)
  };
}

async function chapters(id) {
  const slug = String(id).replace(/^\/series\//, "").replace(/\/$/, "");
  const url = BASE + "/series/" + slug;
  const html = await text(url);
  
  const re = new RegExp('href=["\'](?:https?:\\/\\/mangatuk\\.com)?\\/series\\/' + slug + '\\/([^"\'#\\s]+)["\']', 'gi');
  const matches = Array.from(html.matchAll(re));
  
  const out = [];
  for (const m of matches) {
    const rawCh = m[1];
    const cleanNum = rawCh.replace(/^chapter-/, "");
    out.push({
      id: BASE + "/series/" + slug + "/" + rawCh,
      chapter: cleanNum,
      title: "الفصل " + cleanNum,
      number: parseFloat(cleanNum) || 0
    });
  }
  
  const unique = uniq(out, x => x.id);
  unique.sort((a, b) => (b.number || 0) - (a.number || 0));
  return unique;
}

async function pageUrls(chapterId) {
  const url = String(chapterId).startsWith("http") ? chapterId : (BASE + "/series/" + chapterId);
  const html = await text(url);
  
  const matches = Array.from(html.matchAll(/https?:\/\/content\.mangatuk\.com\/(?:WP-manga|axis\/pages)\/[^\s"'<>]+\.(?:webp|jpg|png|jpeg)/gi)).map(m => m[0]);
  return uniq(matches);
}

const plugin = {
  id: "mangatuk-ar",
  name: "مانجاتك (MangaTuk - عربي)",
  popular,
  search,
  detail,
  chapters,
  pageUrls
};

return plugin;
