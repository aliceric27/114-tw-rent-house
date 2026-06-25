const elements = {
  form: document.querySelector("#calculatorForm"),
  address: document.querySelector("#address"),
  parseAddress: document.querySelector("#parseAddress"),
  addressHint: document.querySelector("#addressHint"),
  city: document.querySelector("#city"),
  district: document.querySelector("#district"),
  roomType: document.querySelector("#roomType"),
  buildingAge: document.querySelector("#buildingAge"),
  area: document.querySelector("#area"),
  locationLevel: document.querySelector("#locationLevel"),
  locationTooltip: document.querySelector("#locationTooltip"),
  renovationLevel: document.querySelector("#renovationLevel"),
  renovationTooltip: document.querySelector("#renovationTooltip"),
  equipmentBonus: document.querySelector("#equipmentBonus"),
  equipmentTooltip: document.querySelector("#equipmentTooltip"),
  equipmentHint: document.querySelector("#equipmentHint"),
  contractRent: document.querySelector("#contractRent"),
  heroResult: document.querySelector("#heroResult"),
  maxRent: document.querySelector("#maxRent"),
  statusBadge: document.querySelector("#statusBadge"),
  referencePrice: document.querySelector("#referencePrice"),
  adjustedPrice: document.querySelector("#adjustedPrice"),
  formulaRent: document.querySelector("#formulaRent"),
  formulaTooltip: document.querySelector("#formulaTooltip"),
  intakeLimit: document.querySelector("#intakeLimit"),
  intakeTooltip: document.querySelector("#intakeTooltip"),
  formulaText: document.querySelector("#formulaText"),
};

const CITY_GROUPS = [
  {
    label: "北部",
    cities: ["臺北市", "新北市", "基隆市", "桃園市", "新竹市", "新竹縣", "宜蘭縣"],
  },
  {
    label: "中部",
    cities: ["苗栗縣", "臺中市", "彰化縣", "南投縣", "雲林縣"],
  },
  {
    label: "南部",
    cities: ["嘉義市", "嘉義縣", "臺南市", "高雄市", "屏東縣"],
  },
  {
    label: "東部",
    cities: ["花蓮縣", "臺東縣"],
  },
];

let rentData = null;

function formatCurrency(value) {
  if (!Number.isFinite(value)) {
    return "-";
  }

  return Math.round(value).toLocaleString("zh-TW");
}

function normalizeAddress(value) {
  return value.replace(/\s+/g, "").replace(/台/g, "臺").trim();
}

function is591RentUrl(value) {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && url.hostname === "rent.591.com.tw" && /^\/\d+/.test(url.pathname);
  } catch {
    return false;
  }
}

function isUrlLike(value) {
  return /^https?:\/\//i.test(value.trim());
}

function setAddressHint(message, type = "normal") {
  elements.addressHint.textContent = message;
  elements.addressHint.classList.toggle("error", type === "error");
}

function setAddressHintHtml(html) {
  elements.addressHint.innerHTML = html;
  elements.addressHint.classList.remove("error");
}

function closeTooltips() {
  document.querySelectorAll(".info-dot.is-open").forEach((node) => {
    node.classList.remove("is-open");
  });

  if (document.activeElement?.classList?.contains("info-dot")) {
    document.activeElement.blur();
  }
}

function option(label, value = label) {
  const node = document.createElement("option");
  node.value = value;
  node.textContent = label;
  return node;
}

function fillSelect(select, options, selectedValue) {
  select.replaceChildren(...options);

  if (selectedValue && options.some((node) => node.value === selectedValue)) {
    select.value = selectedValue;
  }
}

function fillCitySelect(selectedValue) {
  const availableCities = new Set(Object.keys(rentData.rentTables));
  const groups = CITY_GROUPS.map((group) => {
    const optgroup = document.createElement("optgroup");
    const cities = group.cities.filter((city) => availableCities.has(city));

    optgroup.label = group.label;

    if (cities.length === 0) {
      const disabledOption = option("本資料未提供");
      disabledOption.disabled = true;
      optgroup.append(disabledOption);
      return optgroup;
    }

    optgroup.append(...cities.map((city) => option(city)));
    return optgroup;
  });

  elements.city.replaceChildren(...groups);

  if (selectedValue && availableCities.has(selectedValue)) {
    elements.city.value = selectedValue;
  }
}

function getRoomTable() {
  return rentData?.rentTables?.[elements.city.value]?.[elements.roomType.value] ?? null;
}

function getAdjustment(group, label) {
  return rentData.adjustments[group].find((item) => item.label === label) ?? rentData.adjustments[group][0];
}

function getAgeBand(age, bands) {
  return bands.find((band) => age >= band.minYears && (band.maxYearsExclusive === null || age < band.maxYearsExclusive)) ?? bands[bands.length - 1];
}

function updateDistricts(previousDistrict) {
  const table = getRoomTable();
  if (!table) {
    elements.district.replaceChildren();
    return;
  }

  fillSelect(
    elements.district,
    table.districts.map((district) => option(district.name)),
    previousDistrict,
  );
}

function updateEquipmentLimit() {
  const max = rentData.adjustments.equipment[elements.roomType.value];
  elements.equipmentBonus.max = String(max);
  elements.equipmentHint.textContent = `本房型設備加值上限 ${formatCurrency(max)} 元/月。`;
  elements.equipmentTooltip.textContent = `案件提供設備優於一般租賃市場水準時可加計，例如冷氣、冰箱、洗衣機或網路。${rentData.roomTypes[elements.roomType.value]}最高可增加 ${formatCurrency(max)} 元/月。`;

  const current = Number(elements.equipmentBonus.value);
  if (Number.isFinite(current) && current > max) {
    elements.equipmentBonus.value = String(max);
  }
}

function getSuggestedEquipmentBonus(listing) {
  const provided = listing.facilities?.provided || [];
  const coreEquipment = ["冷氣", "熱水器", "冰箱", "洗衣機", "網路"];
  const coreCount = coreEquipment.filter((item) => provided.includes(item)).length;

  if (coreCount >= 3) {
    return rentData.adjustments.equipment[elements.roomType.value];
  }

  return null;
}

function populateInitialOptions() {
  fillCitySelect("臺北市");

  fillSelect(
    elements.roomType,
    Object.entries(rentData.roomTypes).map(([value, label]) => option(label, value)),
    "entire_home",
  );

  fillSelect(
    elements.locationLevel,
    rentData.adjustments.location.map((item) => option(`${item.label}（+${Math.round(item.rate * 100)}%）`, item.label)),
    "中下區位",
  );

  fillSelect(
    elements.renovationLevel,
    rentData.adjustments.renovation.map((item) => option(`${item.label}（+${Math.round(item.rate * 100)}%）`, item.label)),
    "無裝修",
  );

  updateDistricts();
  updateEquipmentLimit();
  renderAdjustmentTooltip(elements.locationTooltip, rentData.adjustments.location);
  renderAdjustmentTooltip(elements.renovationTooltip, rentData.adjustments.renovation);
  elements.formulaTooltip.textContent = "公式試算是尚未套用縣市收件上限前的金額：參考單價 × (1 + 區位調整率 + 裝修調整率) × 坪數 + 設備加值。";
  elements.intakeTooltip.textContent = "收件上限是各縣市與房型可受理的月租總價天花板。最後合理租金上限會取公式試算與收件上限兩者較低者。";
}

function renderAdjustmentTooltip(container, items) {
  const fragments = items.map((item) => {
    const wrapper = document.createElement("span");
    const title = document.createElement("span");
    const desc = document.createElement("span");
    const rate = Math.round(item.rate * 100);

    wrapper.className = "tooltip-item";
    title.className = "tooltip-title";
    desc.className = "tooltip-desc";
    title.textContent = `${item.label} +${rate}%`;
    desc.textContent = item.description;

    wrapper.append(title, desc);
    return wrapper;
  });

  container.replaceChildren(...fragments);
}

function setStatus(className, text) {
  elements.statusBadge.className = `status ${className}`;
  elements.statusBadge.textContent = text;
}

function setRentComparison(maxRent, contractRent) {
  const diff = contractRent - maxRent;
  const absDiff = Math.abs(diff);
  let className = "fair";
  let title = "中等";
  let emoji = "⚖️";
  let summary = "實際租金接近合理租金";
  let detail = `差距 ${formatCurrency(absDiff)} 元`;

  if (diff < -2000) {
    className = "cheap";
    title = "便宜";
    emoji = "🟢";
    summary = "實際租金低於合理租金";
    detail = `便宜 ${formatCurrency(absDiff)} 元`;
  } else if (diff > 2000) {
    className = "expensive";
    title = "昂貴";
    emoji = "🔴";
    summary = "實際租金高於合理租金";
    detail = `貴 ${formatCurrency(absDiff)} 元`;
  }

  elements.statusBadge.className = `status comparison ${className}`;
  elements.statusBadge.innerHTML = `
    <div class="comparison-title"><span>${emoji}</span><strong>${title} !</strong></div>
    <dl>
      <div><dt>合理租金</dt><dd>${formatCurrency(maxRent)}</dd></div>
      <div><dt>實際租金</dt><dd>${formatCurrency(contractRent)}</dd></div>
      <div><dt>${summary}</dt><dd>${detail}</dd></div>
    </dl>
  `;
}

function setEmptyResult(message) {
  elements.heroResult.textContent = "-";
  elements.maxRent.textContent = "-";
  elements.referencePrice.textContent = "-";
  elements.adjustedPrice.textContent = "-";
  elements.formulaRent.textContent = "-";
  elements.intakeLimit.textContent = "-";
  elements.formulaText.textContent = message;
  setStatus("neutral", "等待資料");
}

function selectDistrict(districtName) {
  const table = getRoomTable();
  const matchedDistrict = table?.districts.find((item) => item.name === districtName);

  if (matchedDistrict) {
    elements.district.value = matchedDistrict.name;
    return true;
  }

  const fallback = table?.districts.find((item) => item.name === "其他");
  if (fallback) {
    elements.district.value = fallback.name;
  }

  return false;
}

function calculate() {
  if (!rentData) {
    return;
  }

  const table = getRoomTable();
  const age = Number(elements.buildingAge.value);
  const area = Number(elements.area.value);

  if (!table || !Number.isFinite(age) || age < 0 || !Number.isFinite(area) || area <= 0) {
    setEmptyResult("請輸入有效的屋齡與坪數。");
    return;
  }

  const district = table.districts.find((item) => item.name === elements.district.value) ?? table.districts.find((item) => item.name === "其他");
  const ageBand = getAgeBand(age, table.ageBands);
  const referencePrice = district?.prices?.[ageBand.label];

  if (!district || !Number.isFinite(referencePrice)) {
    setEmptyResult("找不到對應的行政區租金資料。");
    return;
  }

  const location = getAdjustment("location", elements.locationLevel.value);
  const renovation = getAdjustment("renovation", elements.renovationLevel.value);
  const equipmentMax = rentData.adjustments.equipment[elements.roomType.value];
  const equipment = Math.min(Math.max(Number(elements.equipmentBonus.value) || 0, 0), equipmentMax);
  const intakeLimit = rentData.intakeLimits[elements.city.value][elements.roomType.value];
  const adjustedUnitPrice = referencePrice * (1 + location.rate + renovation.rate);
  const formulaRent = adjustedUnitPrice * area + equipment;
  const maxRent = Math.min(formulaRent, intakeLimit);
  const contractRent = Number(elements.contractRent.value);

  elements.heroResult.textContent = formatCurrency(maxRent);
  elements.maxRent.textContent = formatCurrency(maxRent);
  elements.referencePrice.textContent = `${formatCurrency(referencePrice)} / 坪`;
  elements.adjustedPrice.textContent = `${formatCurrency(adjustedUnitPrice)} / 坪`;
  elements.formulaRent.textContent = formatCurrency(formulaRent);
  elements.intakeLimit.textContent = formatCurrency(intakeLimit);
  elements.formulaText.textContent = `${formatCurrency(referencePrice)} × (1 + ${Math.round(location.rate * 100)}% + ${Math.round(renovation.rate * 100)}%) × ${area} 坪 + ${formatCurrency(equipment)} = ${formatCurrency(formulaRent)}，再與收件上限 ${formatCurrency(intakeLimit)} 取低者。`;

  if (Number.isFinite(contractRent) && contractRent > 0) {
    setRentComparison(maxRent, contractRent);
  } else if (formulaRent > intakeLimit) {
    setStatus("warn", "公式金額高於縣市收件上限，已採收件上限。");
  } else {
    setStatus("ok", "已依表格完成試算。");
  }
}

function applyAddress() {
  const address = normalizeAddress(elements.address.value);

  if (!address) {
    setAddressHint("請輸入地址，或直接手動選擇縣市與行政區。");
    return;
  }

  const cities = Object.keys(rentData.rentTables).sort((a, b) => b.length - a.length);
  const city = cities.find((item) => address.includes(item));

  if (!city) {
    setAddressHint("沒有在地址中找到可辨識的縣市。");
    return;
  }

  elements.city.value = city;
  updateDistricts();

  const table = getRoomTable();
  const districts = table.districts
    .filter((district) => district.name !== "其他")
    .map((district) => district.name)
    .sort((a, b) => b.length - a.length);
  const district = districts.find((item) => address.includes(item));

  if (district) {
    selectDistrict(district);
    setAddressHint(`已套用 ${city}${district}。`);
  } else {
    selectDistrict("");
    setAddressHint(`已套用 ${city}，行政區未命中，使用目前選項。`);
  }

  calculate();
}

async function apply591Listing(url) {
  const originalButtonText = elements.parseAddress.textContent;
  elements.parseAddress.disabled = true;
  elements.parseAddress.textContent = "讀取中";
  setAddressHint("正在讀取 591 物件資料...");

  try {
    const response = await fetch(`/api/591-listing?url=${encodeURIComponent(url)}`);
    const listing = await response.json();

    if (!response.ok) {
      throw new Error(listing.error || "591 物件資料讀取失敗。");
    }

    const applied = [];
    const missing = [];

    if (listing.address) {
      elements.address.value = listing.address;
      applied.push("地址");
    }

    if (listing.city && rentData.rentTables[listing.city]) {
      elements.city.value = listing.city;
      updateDistricts();
      applied.push("縣市");
    }

    if (listing.district) {
      if (selectDistrict(listing.district)) {
        applied.push("行政區");
      } else {
        missing.push("行政區未命中，已保留目前選項");
      }
    }

    if (listing.roomType && rentData.roomTypes[listing.roomType]) {
      elements.roomType.value = listing.roomType;
      updateDistricts(elements.district.value);
      updateEquipmentLimit();
      applied.push("房型");
    }

    if (Number.isFinite(listing.area) && listing.area > 0) {
      elements.area.value = String(listing.area);
      applied.push("坪數");
    } else {
      missing.push("坪數");
    }

    if (Number.isFinite(listing.contractRent) && listing.contractRent > 0) {
      elements.contractRent.value = String(listing.contractRent);
      applied.push("實際租金");
    } else {
      missing.push("實際租金");
    }

    if (listing.locationLevel && rentData.adjustments.location.some((item) => item.label === listing.locationLevel)) {
      elements.locationLevel.value = listing.locationLevel;
      applied.push("區位");
    }

    if (listing.renovationLevel) {
      elements.renovationLevel.value = listing.renovationLevel;
      applied.push("裝修");
    }

    const suggestedEquipmentBonus = getSuggestedEquipmentBonus(listing);
    if (Number.isFinite(suggestedEquipmentBonus)) {
      elements.equipmentBonus.value = String(suggestedEquipmentBonus);
      applied.push("設備加值");
    }

    if (!Number.isFinite(listing.buildingAge)) {
      missing.push("屋齡");
    }

    calculate();

    const appliedText = applied.length ? `<span class="applied">已套用 ${applied.join("、")}</span>` : "沒有可自動套用的欄位";
    const missingText = missing.length ? `；<span class="missing">未自動填入：${missing.join("、")}</span>` : "";
    setAddressHintHtml(`${appliedText}${missingText}。`);
  } catch (error) {
    setAddressHint(error.message, "error");
    setStatus("fail", error.message);
  } finally {
    elements.parseAddress.disabled = false;
    elements.parseAddress.textContent = originalButtonText;
  }
}

async function parseAddress() {
  const value = elements.address.value.trim();

  if (is591RentUrl(value)) {
    await apply591Listing(value);
    return;
  }

  if (isUrlLike(value)) {
    setAddressHint('網址格式不支援。請輸入正確格式，例如 https://rent.591.com.tw/12345。', "error");
    setStatus("fail", "591 網址格式錯誤");
    return;
  }

  applyAddress();
}

async function init() {
  try {
    const response = await fetch("./data/rent-data.json");
    if (!response.ok) {
      throw new Error(`資料載入失敗：${response.status}`);
    }

    rentData = await response.json();
    populateInitialOptions();
    calculate();
  } catch (error) {
    setEmptyResult("無法載入租金 JSON，請用本機伺服器開啟此頁。");
    setStatus("fail", error.message);
  }
}

elements.parseAddress.addEventListener("click", parseAddress);
elements.address.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    parseAddress();
  }
});

elements.city.addEventListener("change", () => {
  updateDistricts();
  calculate();
});

elements.roomType.addEventListener("change", () => {
  const previousDistrict = elements.district.value;
  updateDistricts(previousDistrict);
  updateEquipmentLimit();
  calculate();
});

elements.form.addEventListener("input", calculate);
elements.form.addEventListener("change", calculate);

document.querySelectorAll(".info-dot").forEach((node) => {
  node.addEventListener("click", (event) => {
    event.stopPropagation();
    const shouldOpen = !node.classList.contains("is-open");
    closeTooltips();
    node.classList.toggle("is-open", shouldOpen);
  });
});

document.addEventListener("click", closeTooltips);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeTooltips();
  }
});

init();
