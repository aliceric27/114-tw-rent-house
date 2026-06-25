const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const SOURCE_PATH = path.join(ROOT, "114-rent.md");
const OUTPUT_PATH = path.join(ROOT, "public", "data", "rent-data.json");

const ROOM_TYPES = {
  "整層(戶)": "entire_home",
  "整層（戶）": "entire_home",
  "獨立套房": "studio",
};

const ROOM_TYPE_LABELS = {
  entire_home: "整層（戶）",
  studio: "獨立套房",
};

const ALL_CITIES = [
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

function cleanText(value) {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function parseNumber(value) {
  const normalized = cleanText(value).replace(/,/g, "");
  const number = Number(normalized);
  if (!Number.isFinite(number)) {
    throw new Error(`Cannot parse number: ${value}`);
  }
  return number;
}

function parsePercent(value) {
  return parseNumber(value.replace("%", "")) / 100;
}

function parseRows(tableHtml) {
  const rows = [];
  const rowPattern = /<tr>([\s\S]*?)<\/tr>/g;
  let rowMatch;

  while ((rowMatch = rowPattern.exec(tableHtml))) {
    const cells = [];
    const cellPattern = /<td>([\s\S]*?)<\/td>/g;
    let cellMatch;

    while ((cellMatch = cellPattern.exec(rowMatch[1]))) {
      cells.push(cleanText(cellMatch[1]));
    }

    if (cells.length > 0) {
      rows.push(cells);
    }
  }

  return rows;
}

function parseAgeBand(label) {
  const cleaned = cleanText(label);
  if (cleaned === "40年以上") {
    return { label: cleaned, minYears: 40, maxYearsExclusive: null };
  }

  const range = cleaned.match(/^(\d+)-(\d+)年\(未滿\d+\)$/);
  if (!range) {
    throw new Error(`Cannot parse age band: ${label}`);
  }

  return {
    label: cleaned,
    minYears: Number(range[1]),
    maxYearsExclusive: Number(range[2]),
  };
}

function tableTitleMatches(source) {
  const matches = [];
  const titlePattern = /^表[一二三四五六七八九十百〇零]+、(.+)$/gm;
  let match;

  while ((match = titlePattern.exec(source))) {
    const title = match[0].trim();
    const afterTitle = source.slice(titlePattern.lastIndex);
    const tableMatch = afterTitle.match(/<table>[\s\S]*?<\/table>/);

    if (!tableMatch) {
      continue;
    }

    const between = afterTitle.slice(0, tableMatch.index);
    if (between.includes("表")) {
      continue;
    }

    matches.push({
      title,
      html: tableMatch[0],
    });
  }

  return matches;
}

function expandIntakeLimitRow(cityGroup) {
  if (cityGroup === "其他縣市") {
    return ALL_CITIES.filter(
      (city) =>
        ![
          "臺北市",
          "新北市",
          "桃園市",
          "臺中市",
          "新竹市",
          "新竹縣",
          "臺南市",
          "高雄市",
        ].includes(city),
    );
  }

  return cityGroup.split("、").map((city) => city.trim());
}

function parseIntakeLimits(rows) {
  const limits = {};

  for (const row of rows.slice(1)) {
    const [cityGroup, entireHome, studio] = row;
    for (const city of expandIntakeLimitRow(cityGroup)) {
      limits[city] = {
        entire_home: parseNumber(entireHome),
        studio: parseNumber(studio),
      };
    }
  }

  return limits;
}

function parseAdjustmentRows(rows) {
  return rows.slice(1).map(([label, rate, description]) => ({
    label,
    rate: parsePercent(rate),
    description,
  }));
}

function parseRentTable(title, rows) {
  const titleMatch = title.match(/^表.+、(.+?)各區租金單價表-(整層（戶）|獨立套房)$/);
  if (!titleMatch) {
    throw new Error(`Cannot parse rent table title: ${title}`);
  }

  const cityLabel = titleMatch[1];
  const roomType = ROOM_TYPES[titleMatch[2]];
  const cityNames = cityLabel === "新竹縣市" ? ["新竹市", "新竹縣"] : cityLabel === "嘉義縣市" ? ["嘉義市", "嘉義縣"] : [cityLabel];
  const ageBands = rows[0].slice(1).map(parseAgeBand);
  const districts = rows.slice(1).map((row) => {
    const prices = {};

    for (let i = 1; i < row.length; i += 1) {
      prices[ageBands[i - 1].label] = parseNumber(row[i]);
    }

    return {
      name: row[0],
      prices,
    };
  });

  return {
    cityNames,
    roomType,
    ageBands,
    districts,
  };
}

function mergeRentTable(rentTables, parsedTable) {
  for (const city of parsedTable.cityNames) {
    if (!rentTables[city]) {
      rentTables[city] = {};
    }

    rentTables[city][parsedTable.roomType] = {
      label: ROOM_TYPE_LABELS[parsedTable.roomType],
      ageBands: parsedTable.ageBands,
      districts: parsedTable.districts,
    };
  }
}

function main() {
  if (!fs.existsSync(SOURCE_PATH)) {
    if (fs.existsSync(OUTPUT_PATH)) {
      console.log(`Source ${SOURCE_PATH} not found; keeping existing ${OUTPUT_PATH}`);
      return;
    }

    throw new Error(`Source ${SOURCE_PATH} not found and ${OUTPUT_PATH} does not exist.`);
  }

  const source = fs.readFileSync(SOURCE_PATH, "utf8").replace(/\r\n/g, "\n");
  const tables = tableTitleMatches(source);

  if (tables.length !== 37) {
    throw new Error(`Expected 37 tables, got ${tables.length}`);
  }

  const data = {
    metadata: {
      title: "社會住宅包租代管中央版租金水準區間表",
      version: "2025-12",
      sourceFile: "114-rent.md",
      unit: "新臺幣元／坪／月",
      generatedAt: new Date().toISOString(),
    },
    roomTypes: ROOM_TYPE_LABELS,
    intakeLimits: {},
    adjustments: {
      location: [],
      renovation: [],
      equipment: {
        entire_home: 2000,
        studio: 1000,
      },
    },
    rentTables: {},
  };

  for (const table of tables) {
    const rows = parseRows(table.html);

    if (table.title.includes("各縣市類型收件上限表")) {
      data.intakeLimits = parseIntakeLimits(rows);
      continue;
    }

    if (table.title.includes("區位因素調整表")) {
      data.adjustments.location = parseAdjustmentRows(rows);
      continue;
    }

    if (table.title.includes("室內裝修調整表")) {
      data.adjustments.renovation = parseAdjustmentRows(rows);
      continue;
    }

    mergeRentTable(data.rentTables, parseRentTable(table.title, rows));
  }

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(data, null, 2)}\n`, "utf8");

  const districtCount = Object.values(data.rentTables).reduce((sum, city) => {
    return sum + Object.values(city).reduce((citySum, table) => citySum + table.districts.length, 0);
  }, 0);

  console.log(`Wrote ${OUTPUT_PATH}`);
  console.log(`Cities: ${Object.keys(data.rentTables).length}`);
  console.log(`Room tables: ${Object.values(data.rentTables).reduce((sum, city) => sum + Object.keys(city).length, 0)}`);
  console.log(`District rows: ${districtCount}`);
}

main();
