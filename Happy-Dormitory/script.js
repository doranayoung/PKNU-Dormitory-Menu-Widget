// Variables used by Scriptable.
// icon-color: red; icon-glyph: utensils;
 
/**
 * 부경대행복기숙사(한국사학진흥재단) 주간식단표 위젯
 * -------------------------------------------------------------
 * 출처: https://happydorm.or.kr/busan/ko/0605/cafeteria/menu/ (주간식단표)
 *
 * 이 사이트는 PKNU 세종기숙사(dormitory.pknu.ac.kr)와 달리 AJAX 호출이 필요
 * 없다. 페이지 하나를 그냥 불러오면 이번 주(월~일) 7일치 식단표가
 * <table class="table__week week_menu_YYYY-MM-DD">...</table> 형태로
 * 전부 정적으로 박혀 있고, 화면의 요일 버튼은 그중 하나만 보여주고
 * 나머지는 JS로 숨기는(show/hide) 방식일 뿐이다. 그래서 오늘 날짜에
 * 해당하는 table만 정규식으로 잘라내면 된다.
 *
 * 각 날짜 table 안에는 조식/중식/석식 3개 구간이 있고, 구간마다
 * "일반메뉴" + (끼니에 따라) "샐러드/후식" + "TAKE - OUT" 행이 있다.
 * PC용 칸(class="meal__PC")과 모바일용 중복 칸(class="meal__M")이
 * 나란히 들어있어서, PC용 칸만 골라서 쓴다.
 *
 * 참고: 이 서버는 일반적인 HTTP 클라이언트 요청을 막는 봇 차단이
 * 걸려 있을 수 있어(테스트 중 403을 받음), 브라우저처럼 보이는
 * User-Agent를 붙여서 요청한다. 그래도 막히면 헤더를 더 보강해야 할
 * 수 있다.
 *
 * ── 캐싱 ──────────────────────────────────────────────────────
 * PKNU 세종기숙사 위젯과 동일하게, 위젯을 열 때마다 항상 서버에 새로
 * 요청한다. 성공하면 결과를 로컬 파일에 덮어써 두고, 이 요청이 인터넷
 * 문제로 실패했을 때만 마지막으로 저장해둔 캐시를 대신 보여준다(오늘
 * 것인지 며칠 전 것인지도 같이 표시). 캐시조차 없으면 "📶 인터넷 연결
 * 없음" 상태를 보여준다. 캐시 파일은 하나만 계속 덮어쓰므로 용량이
 * 누적되지 않는다.
 */
 
// 위젯 파라미터로 다른 사이트(예: 대구/세종/천안 등 happydorm 계열)의 전체 URL을
// 넘기면 그걸 쓰고, 없으면 부경대행복기숙사(busan) 기본값 사용
const MENU_URL = (typeof args !== "undefined" && args.widgetParameter)
  ? args.widgetParameter
  : "https://happydorm.or.kr/busan/ko/0605/cafeteria/menu/";
 
// ---------------------------------------------------------------
// 캐시 저장/조회 (파일 하나만 계속 덮어씀 → 용량 누적 없음)
// ---------------------------------------------------------------
const fm = FileManager.local();
const CACHE_PATH = fm.joinPath(fm.documentsDirectory(), "happydorm_busan_meal_cache.json");
// 파싱 로직을 고칠 때마다 이 값을 올리면, 예전 버전으로 저장된 캐시는
// 버전이 안 맞아 자동으로 무효화되고 그날 안에라도 바로 새로 크롤링한다.
// (스크립트만 갈아끼우고 캐시 파일은 안 지워서 옛날 결과가 계속 보이는
// 문제를 막기 위함)
const CACHE_VERSION = 2;
 
function pad2(n) {
  return String(n).padStart(2, "0");
}
 
function dateKeyOf(d) {
  // happydorm 사이트의 class명 형식(YYYY-MM-DD, 0채움)에 맞춤
  return `${d.year}-${pad2(d.month)}-${pad2(d.day)}`;
}
 
function loadCache() {
  try {
    if (!fm.fileExists(CACHE_PATH)) return null;
    const cached = JSON.parse(fm.readString(CACHE_PATH));
    if (cached.version !== CACHE_VERSION) return null; // 옛날 파싱 버전 캐시는 무효 처리
    return cached;
  } catch (e) {
    return null;
  }
}
 
function saveCache(dateKey, menu) {
  try {
    fm.writeString(CACHE_PATH, JSON.stringify({ version: CACHE_VERSION, dateKey, menu }));
  } catch (e) {
    // 저장 실패해도 위젯 자체는 계속 동작해야 하므로 무시
  }
}
 
// ---------------------------------------------------------------
// 유틸: 한국시간(KST) 기준 오늘 날짜
// ---------------------------------------------------------------
function getKSTToday() {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "numeric",
    day: "numeric"
  });
  const parts = {};
  for (const p of fmt.formatToParts(new Date())) {
    parts[p.type] = p.value;
  }
  return {
    year: parseInt(parts.year, 10),
    month: parseInt(parts.month, 10),
    day: parseInt(parts.day, 10)
  };
}
 
// ---------------------------------------------------------------
// 페이지 통째로 가져오기 (GET 한 번, AJAX 없음)
// ---------------------------------------------------------------
async function fetchMenuPageHTML() {
  const req = new Request(MENU_URL);
  req.method = "GET";
  req.headers = {
    "User-Agent":
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ko-KR,ko;q=0.9"
  };
  return await req.loadString();
}
 
// ---------------------------------------------------------------
// 파싱: 오늘 날짜에 해당하는 <table class="table__week week_menu_YYYY-MM-DD"> 잘라내기
// ---------------------------------------------------------------
function extractDayTable(html, dateKey) {
  const regex = new RegExp(
    `<table class="table__week week_menu_${dateKey}[^"]*"[\\s\\S]*?<\\/table>`
  );
  const m = html.match(regex);
  return m ? m[0] : null;
}
 
// ---------------------------------------------------------------
// 파싱: 하루 table 안에서 조식/중식/석식 구간만 잘라내기
// (각 구간은 rowspan 달린 <th class="meal__PC">라벨</th>로 시작해서
//  다음 라벨 전까지)
// ---------------------------------------------------------------
function extractMealSection(dayHtml, mealLabel) {
  const labels = ["조식", "중식", "석식"];
  const startRe = new RegExp(`<th class="meal__PC" rowspan="\\d+">${mealLabel}<\\/th>`);
  const startMatch = dayHtml.match(startRe);
  if (!startMatch) return "";
 
  const startIdx = startMatch.index;
  let endIdx = dayHtml.length;
  for (const other of labels) {
    if (other === mealLabel) continue;
    const otherRe = new RegExp(`<th class="meal__PC" rowspan="\\d+">${other}<\\/th>`);
    const rest = dayHtml.slice(startIdx + 1);
    const m = rest.match(otherRe);
    if (m) {
      const idx = startIdx + 1 + m.index;
      if (idx < endIdx) endIdx = idx;
    }
  }
  return dayHtml.slice(startIdx, endIdx);
}
 
// ---------------------------------------------------------------
// 칸 하나(raw HTML)를 정리 (<br> → 줄바꿈, 태그 제거, 엔티티 정리)
// ---------------------------------------------------------------
function cleanMealCell(raw) {
  if (!raw) return "";
  const text = raw
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  // "정식 : ..." / "일품 : ..." 처럼 원래 <br><br>로 구분되어 있던 줄은
  // 화면에서도 줄바꿈으로 보이도록 줄바꿈 문자로 이어붙인다
  return lines.join("\n");
}
 
// ---------------------------------------------------------------
// 한 끼니 구간 안에서 "일반메뉴" + "샐러드/후식" + "TAKE - OUT" 등
// PC용 칸(td.meal__PC) 내용을 순서대로 모아서 정리.
//  - 메인 메뉴(라벨이 조식/중식/석식인 첫 행)는 라벨 생략 (이미 배지로 표시됨)
//  - "TAKE - OUT", "샐러드/후식" 같은 부가 항목은 "라벨 : 내용" 형태로 표시
//  - 정식/일품처럼 원래 줄바꿈되어 있던 항목은 줄바꿈 유지, 서로 다른
//    항목끼리도 줄바꿈으로 구분
// ---------------------------------------------------------------
function extractMealText(sectionHtml) {
  if (!sectionHtml) return "";
  const pairRegex =
    /<th[^>]*class="[^"]*meal__PC[^"]*"[^>]*>([\s\S]*?)<\/th>[\s\S]*?<td class="meal__PC">([\s\S]*?)<\/td>/g;
  const mealLabels = ["조식", "중식", "석식"];
  const parts = [];
  let m;
  while ((m = pairRegex.exec(sectionHtml)) !== null) {
    const label = m[1]
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const content = cleanMealCell(m[2]);
    if (!content) continue;
    if (mealLabels.includes(label)) {
      parts.push(content);
    } else {
      parts.push(`${label} : ${content}`);
    }
  }
  return parts.join("\n");
}
 
// ---------------------------------------------------------------
// 서버에서 오늘 메뉴 가져오기. 네트워크 에러가 나면 그대로 throw.
// ---------------------------------------------------------------
async function fetchTodayMenuFromServer(today) {
  const dateKey = dateKeyOf(today);
  const dateLabel = `${today.month}/${today.day}`;
 
  const html = await fetchMenuPageHTML();
  const dayHtml = extractDayTable(html, dateKey);
 
  if (!dayHtml) {
    return {
      found: false,
      dateLabel,
      breakfast: "제공 없음",
      lunch: "제공 없음",
      dinner: "제공 없음"
    };
  }
 
  const breakfast = extractMealText(extractMealSection(dayHtml, "조식")) || "제공 없음";
  const lunch = extractMealText(extractMealSection(dayHtml, "중식")) || "제공 없음";
  const dinner = extractMealText(extractMealSection(dayHtml, "석식")) || "제공 없음";
 
  return { found: true, dateLabel, breakfast, lunch, dinner };
}
 
// ---------------------------------------------------------------
// 오늘 메뉴 가져오기 (매번 새로 크롤링, 캐시는 실패했을 때의 대비용)
//  - 위젯이 열릴 때마다 항상 서버에 새로 요청한다 (학교가 중간에 식단을
//    수정해도 바로 반영되도록). 결과는 매번 캐시에 덮어써 둔다.
//  - 이번 요청이 인터넷 문제로 실패하면, 마지막으로 저장해둔 캐시를
//    대신 보여준다. 이때 캐시가 오늘 것인지 며칠 전 것인지도 표시한다.
//  - 캐시조차 하나도 없으면(최초 실행 + 인터넷 없음) "인터넷 연결
//    없음" 상태를 보여준다.
// ---------------------------------------------------------------
async function getTodayMenu() {
  const today = getKSTToday();
  const todayKey = dateKeyOf(today);
 
  try {
    const menu = await fetchTodayMenuFromServer(today);
    saveCache(todayKey, menu);
    return { ...menu, fromCache: false };
  } catch (e) {
    const cached = loadCache();
    if (cached) {
      return {
        ...cached.menu,
        fromCache: true,
        cachedDateKey: cached.dateKey,
        isStale: cached.dateKey !== todayKey
      };
    }
    return {
      networkError: true,
      dateLabel: `${today.month}/${today.day}`
    };
  }
}
 
// ---------------------------------------------------------------
// 위젯 UI
// ---------------------------------------------------------------
async function createWidget(menu) {
  const w = new ListWidget();
  w.backgroundColor = new Color("#1c1c1e");
  w.setPadding(14, 14, 14, 14);
 
  const titleStack = w.addStack();
  titleStack.centerAlignContent();
  const title = titleStack.addText("🍽 행복기숙사 오늘의 식단");
  title.font = Font.boldSystemFont(14);
  title.textColor = Color.white();
  titleStack.addSpacer();
  const dateText = titleStack.addText(menu.dateLabel);
  dateText.font = Font.mediumSystemFont(12);
  dateText.textColor = new Color("#8e8e93");
 
  w.addSpacer(10);
 
  if (menu.networkError) {
    const msg1 = w.addText("📶 인터넷 연결 없음");
    msg1.font = Font.boldSystemFont(13);
    msg1.textColor = Color.white();
    w.addSpacer(4);
    const msg2 = w.addText("오늘 식단을 아직 못 가져왔어요.\n인터넷에 연결한 뒤 다시 열어보세요.");
    msg2.font = Font.systemFont(11);
    msg2.textColor = new Color("#8e8e93");
    msg2.lineLimit = 3;
 
    w.addSpacer();
    const footer = w.addText("happydorm.or.kr");
    footer.font = Font.systemFont(9);
    footer.textColor = new Color("#636366");
 
    w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);
    return w;
  }
 
  const meals = [
    { label: "조식", value: menu.breakfast, color: "#ffd166" },
    { label: "중식", value: menu.lunch, color: "#06d6a0" },
    { label: "석식", value: menu.dinner, color: "#ef476f" }
  ];
 
  meals.forEach((meal, i) => {
    const row = w.addStack();
    row.layoutHorizontally();
    row.topAlignContent();
 
    const badge = row.addText(meal.label);
    badge.font = Font.boldSystemFont(12);
    badge.textColor = new Color(meal.color);
    badge.leftAlignText();
 
    row.addSpacer(8);
 
    const valueStack = row.addStack();
    valueStack.layoutVertically();
    const valueText = valueStack.addText(meal.value);
    valueText.font = Font.systemFont(11);
    valueText.textColor = Color.white();
    valueText.lineLimit = 6;
    valueText.minimumScaleFactor = 0.6;
 
    if (i < meals.length - 1) w.addSpacer(8);
  });
 
  w.addSpacer();
  let footerText;
  if (!menu.found) {
    footerText = "이번 주 식단 정보 없음 (방학/미운영 가능)";
  } else if (menu.fromCache && menu.isStale) {
    footerText = `⚠️ ${menu.cachedDateKey.split("-").slice(1).join("/")} 기준 (오프라인, 갱신 실패)`;
  } else if (menu.fromCache) {
    footerText = "happydorm.or.kr · 방금 갱신 실패, 최근 데이터 표시";
  } else {
    footerText = "happydorm.or.kr";
  }
  const footer = w.addText(footerText);
  footer.font = Font.systemFont(9);
  footer.textColor = new Color("#636366");
 
  w.refreshAfterDate = new Date(Date.now() + 60 * 60 * 1000);
 
  return w;
}
 
// ---------------------------------------------------------------
// 에러 위젯 (파싱 실패 등 네트워크 문제가 아닌 예외 상황)
// ---------------------------------------------------------------
function createErrorWidget(error) {
  const w = new ListWidget();
  w.backgroundColor = new Color("#1c1c1e");
  w.setPadding(14, 14, 14, 14);
  const t = w.addText("⚠️ 식단을 불러오지 못했어요");
  t.font = Font.boldSystemFont(13);
  t.textColor = Color.white();
  w.addSpacer(6);
  const d = w.addText(String(error && error.message ? error.message : error));
  d.font = Font.systemFont(10);
  d.textColor = new Color("#8e8e93");
  d.lineLimit = 4;
  w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);
  return w;
}
 
// ---------------------------------------------------------------
// 실행
// ---------------------------------------------------------------
async function run() {
  let widget;
  try {
    const menu = await getTodayMenu();
    widget = await createWidget(menu);
  } catch (e) {
    widget = createErrorWidget(e);
  }
 
  if (config.runsInWidget) {
    Script.setWidget(widget);
  } else {
    await widget.presentMedium();
  }
  Script.complete();
}
 
await run();