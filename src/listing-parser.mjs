const SUPPORTED_CITIES = [
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

const UNSUPPORTED_CITIES = ["金門縣", "澎湖縣", "連江縣"];
const TAIWAN_CITIES = [...SUPPORTED_CITIES, ...UNSUPPORTED_CITIES];

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

function extractFacilities(html) {
  const start = html.indexOf("提供設備/家具");

  if (start === -1) {
    return { provided: [], notProvided: [] };
  }

  const snippet = html.slice(start, start + 4500);
  const matches = snippet.matchAll(/<dl class="([^"]*)"[\s\S]*?<dd class="text"[^>]*>([\s\S]*?)<\/dd><\/dl>/g);
  const provided = [];
  const notProvided = [];

  for (const match of matches) {
    const name = stripTags(match[2]);
    if (!name) {
      continue;
    }

    if (match[1].split(/\s+/).includes("del")) {
      notProvided.push(name);
    } else {
      provided.push(name);
    }
  }

  return { provided, notProvided };
}

function getSurroundCategorySnippet(html, category) {
  const marker = `surround-list-box ${category}`;
  const start = html.indexOf(marker);

  if (start === -1) {
    return "";
  }

  const nextStart = ["traffic", "live", "education"]
    .map((item) => html.indexOf(`surround-list-box ${item}`, start + marker.length))
    .filter((index) => index > start)
    .sort((a, b) => a - b)[0];

  return html.slice(start, nextStart > 0 ? nextStart : start + 3500);
}

function extractNearbyItems(snippet) {
  const items = [];
  const nearbyCounts = [];
  const matches = snippet.matchAll(/<p class="icon-([^"]*)"[\s\S]*?<\/p>/g);

  for (const match of matches) {
    const type = match[1].trim();
    const text = stripTags(match[0]);
    const distanceMatch = text.match(/距\s*(.+?)\s*(\d+)\s*公尺/u);

    if (distanceMatch) {
      items.push({
        type,
        name: distanceMatch[1].trim(),
        distanceMeters: Number(distanceMatch[2]),
      });
      continue;
    }

    for (const countMatch of text.matchAll(/附近有\s*(\d+)\s*(?:家|所)/gu)) {
      nearbyCounts.push(Number(countMatch[1]));
    }
  }

  return { items, nearbyCounts };
}

function minDistance(items, predicate = () => true) {
  const distances = items.filter(predicate).map((item) => item.distanceMeters).filter(Number.isFinite);
  return distances.length ? Math.min(...distances) : null;
}

function inferLocationLevel(signals) {
  const massTransitMin = minDistance(signals.traffic.items, (item) => /subway|train|rail|mrt/i.test(item.type));
  const busMin = minDistance(signals.traffic.items, (item) => /bus/i.test(item.type));
  const trafficMin = minDistance(signals.traffic.items);
  const lifeMin = minDistance(signals.life.items);
  const educationMin = minDistance(signals.education.items);
  const lifeNearbyTotal = signals.life.nearbyCounts.reduce((sum, count) => sum + count, 0);
  const convenienceWords = ["便利商店", "傳統市場", "百貨公司", "公園綠地", "學校", "醫療機構", "近商圈"];
  const convenienceCount = convenienceWords.filter((word) => signals.text.includes(word)).length;

  const strongTransit =
    (Number.isFinite(massTransitMin) && massTransitMin <= 800) ||
    (Number.isFinite(busMin) && busMin <= 300) ||
    signals.text.includes("近捷運");
  const moderateTransit =
    strongTransit ||
    (Number.isFinite(massTransitMin) && massTransitMin <= 1200) ||
    (Number.isFinite(busMin) && busMin <= 600) ||
    (Number.isFinite(trafficMin) && trafficMin <= 800);
  const strongLife = (Number.isFinite(lifeMin) && lifeMin <= 300) || lifeNearbyTotal >= 12 || convenienceCount >= 4;
  const moderateLife = strongLife || (Number.isFinite(lifeMin) && lifeMin <= 800) || lifeNearbyTotal >= 5 || convenienceCount >= 2;
  const nearbyEducation = Number.isFinite(educationMin) && educationMin <= 600;

  let score = 0;
  score += strongTransit ? 2 : moderateTransit ? 1 : 0;
  score += strongLife ? 2 : moderateLife ? 1 : 0;
  score += nearbyEducation ? 1 : 0;

  if (score >= 4 && moderateTransit && moderateLife) {
    return "優質區位";
  }

  if (score >= 2) {
    return "中上區位";
  }

  return signals.hasSignals ? "中下區位" : "";
}

function extractLocationSignals(html, pageText) {
  const traffic = extractNearbyItems(getSurroundCategorySnippet(html, "traffic"));
  const life = extractNearbyItems(getSurroundCategorySnippet(html, "live"));
  const education = extractNearbyItems(getSurroundCategorySnippet(html, "education"));
  const surroundStart = html.indexOf("位置與周邊");
  const surroundEnd = html.indexOf("租住與設備", surroundStart);
  const surroundText =
    surroundStart >= 0 ? normalizeTaiwanText(stripTags(html.slice(surroundStart, surroundEnd > surroundStart ? surroundEnd : surroundStart + 9000))) : "";
  const text = `${surroundText} ${pageText}`;
  const hasSignals = traffic.items.length > 0 || life.items.length > 0 || education.items.length > 0 || /附近有\d+(?:家|所)/u.test(text);

  return {
    hasSignals,
    level: "",
    text,
    traffic,
    life,
    education,
  };
}

function extractCityDistrict(text) {
  const normalized = normalizeTaiwanText(text);
  const cityMatch = TAIWAN_CITIES.map((item) => ({ name: item, index: normalized.indexOf(item) }))
    .filter((item) => item.index >= 0)
    .sort((a, b) => a.index - b.index)[0];
  const city = cityMatch?.name || "";

  if (!city) {
    return { city: "", district: "" };
  }

  const afterCity = normalized.slice(cityMatch.index + city.length);
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
  const facilities = extractFacilities(html);
  const locationSignals = extractLocationSignals(html, pageText);
  const locationLevel = inferLocationLevel(locationSignals);
  const textForType = `${description} ${keywords}`;
  const streetAddress = visibleAddress || `${cityDistrict.city}${cityDistrict.district}`;
  const address = streetAddress.startsWith(cityDistrict.city) ? streetAddress : `${cityDistrict.city}${streetAddress}`;

  locationSignals.level = locationLevel;
  delete locationSignals.text;

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
    locationLevel,
    locationSignals,
    renovationLevel: inferRenovationLevel(decoration),
    facilities,
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

  const listing = parse591Listing(await result.text(), target);

  if (UNSUPPORTED_CITIES.includes(listing.city)) {
    const error = new Error(`目前租金水準區間表未提供${listing.city}資料，無法試算。請改用表內縣市物件。`);
    error.status = 422;
    throw error;
  }

  return listing;
}
