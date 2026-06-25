const TAIWAN_CITIES = [
  "臺北市",
  "新北市",
  "桃園市",
  "臺中市",
  "臺南市",
  "高雄市",
  "基隆市",
  "新竹市",
  "新竹縣",
  "苗栗縣",
  "彰化縣",
  "南投縣",
  "雲林縣",
  "嘉義市",
  "嘉義縣",
  "屏東縣",
  "宜蘭縣",
  "花蓮縣",
  "臺東縣",
];

export function normalizeTaiwanText(value) {
  return String(value || "").replace(/台/g, "臺").trim();
}

export function decodeHtml(value) {
  return String(value || "")
    .replace(/\\u002F/g, "/")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export function stripTags(value) {
  return decodeHtml(value)
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseNumber(value) {
  const match = String(value || "").replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

export function isAllowed591Url(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "rent.591.com.tw" && /^\/\d+/.test(url.pathname);
  } catch {
    return false;
  }
}

function extractJsonLdProduct(html) {
  const scripts = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) || [];

  for (const script of scripts) {
    const jsonText = script.replace(/^<script type="application\/ld\+json">/, "").replace(/<\/script>$/, "");
    try {
      const parsed = JSON.parse(jsonText);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      const product = items.find((item) => item["@type"] === "Product");

      if (product) {
        return product;
      }
    } catch {
      continue;
    }
  }

  return {};
}

function extractMetaContent(html, name) {
  const pattern = new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']+)["']`, "i");
  return decodeHtml(html.match(pattern)?.[1] || "");
}

function extractLabeledValue(html, label) {
  const index = html.indexOf(label);

  if (index === -1) {
    return "";
  }

  const snippet = html.slice(index, index + 700);
  const valueMatch = snippet.match(/class="value"[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/);
  return valueMatch ? stripTags(valueMatch[1]) : "";
}

function extract591VisibleAddress(html) {
  const match = html.match(/data-gtm-behavior="address"[\s\S]{0,500}?<div[^>]*>([\s\S]*?)<\/div>/);
  return match ? stripTags(match[1]) : "";
}

function extractCityDistrict(text) {
  const normalized = normalizeTaiwanText(text);
  const city = TAIWAN_CITIES.find((item) => normalized.includes(item));

  if (!city) {
    return { city: "", district: "" };
  }

  const afterCity = normalized.slice(normalized.indexOf(city) + city.length);
  const district = afterCity.match(/^(.{1,4}?[區鄉鎮市])/u)?.[1] || "";

  return { city, district };
}

function inferRoomType(text) {
  if (/整層住家|整層/.test(text)) {
    return "entire_home";
  }

  if (/獨立套房/.test(text)) {
    return "studio";
  }

  if (/住家出租/.test(text)) {
    return "entire_home";
  }

  return "";
}

function inferRenovationLevel(value) {
  if (/簡易|簡單|基本/.test(value)) {
    return "簡易裝修";
  }

  if (/中等|精緻|高級|豪華|設計/.test(value)) {
    return "中等裝修";
  }

  if (/無|未/.test(value)) {
    return "無裝修";
  }

  return "";
}

export function parse591Listing(html, sourceUrl) {
  const product = extractJsonLdProduct(html);
  const description = normalizeTaiwanText(product.description || extractMetaContent(html, "description"));
  const keywords = normalizeTaiwanText(extractMetaContent(html, "keywords"));
  const pageText = normalizeTaiwanText(stripTags(html));
  const cityDistrict = extractCityDistrict(`${description} ${keywords} ${pageText}`);
  const visibleAddress = normalizeTaiwanText(extract591VisibleAddress(html) || extractLabeledValue(html, "地址"));
  const usableArea = extractLabeledValue(html, "可使用面積");
  const buildingArea = extractLabeledValue(html, "建物面積");
  const decoration = extractLabeledValue(html, "裝潢程度");
  const textForType = `${description} ${keywords}`;
  const streetAddress = visibleAddress || `${cityDistrict.city}${cityDistrict.district}`;
  const address = streetAddress.startsWith(cityDistrict.city) ? streetAddress : `${cityDistrict.city}${streetAddress}`;

  return {
    source: "591",
    sourceUrl,
    title: product.name || extractMetaContent(html, "og:title"),
    address,
    city: cityDistrict.city,
    district: cityDistrict.district,
    roomType: inferRoomType(textForType),
    area: parseNumber(usableArea) ?? parseNumber(buildingArea),
    buildingAge: null,
    contractRent: parseNumber(product.offers?.price) ?? parseNumber(pageText.match(/月租\s*([\d,]+)/)?.[1]),
    renovationLevel: inferRenovationLevel(decoration),
    raw: {
      usableArea,
      buildingArea,
      decoration,
    },
  };
}

export async function fetch591Listing(target, fetchImpl = fetch) {
  if (!isAllowed591Url(target)) {
    const error = new Error("只支援 https://rent.591.com.tw/{物件編號} 的租屋網址。");
    error.status = 400;
    throw error;
  }

  const result = await fetchImpl(target, {
    headers: {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
      "accept-language": "zh-TW,zh;q=0.9,en;q=0.8",
    },
  });

  if (!result.ok) {
    const error = new Error(`591 回應失敗：HTTP ${result.status}`);
    error.status = 502;
    throw error;
  }

  return parse591Listing(await result.text(), target);
}
