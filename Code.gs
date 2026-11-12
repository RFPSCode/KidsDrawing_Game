/* 拒毒萌芽小畫家 Code.gs —— 由 build.js 產生。整份貼到 Apps Script 的 Code.gs。 */
/* ============================================================================
 * 拒毒萌芽小畫家｜共用程式（同一份程式會被打包進 Code.gs 與 index.html）
 *   ‧ 世界、階級、經濟公式、關卡資料
 *   ‧ 向量物件幾何（路徑、外框、縮放）
 *   ‧ 過關規則檢查
 *   ‧ 後端商業邏輯 makeServer(env)：雲端時 env 接 Google 試算表，單機示範時 env 接記憶體
 * ========================================================================== */

var PA_VERSION = '2.5.0（拒毒萌芽小畫家・名冊管理版）';
var SCHEMA_VERSION = 4;  // 試算表欄位版本（加欄位時 +1）
var LEVELS_VERSION = 'INK-2026-11-12a';

var SHEETS = { CLASSES: 'Classes', STUDENTS: 'Students', LOGS: 'Progress_Logs', LEVELS: 'Levels', FEED: 'Live_Feed', ADMIN: 'Admin' };
var HEADERS = {
  Classes: ['Class_ID', 'Class_Name', 'Status', 'Allowed_Time_Start', 'Allowed_Time_End', 'Max_Level_Limit', 'Teacher_Broadcast', 'Updated_Timestamp'],
  Students: ['Student_ID', 'Class_ID', 'Seat_No', 'Name', 'Password', 'Session_Token', 'Gold', 'Current_Level', 'Current_Fail_Count', 'Cleared_Stars_JSON', 'Look_JSON', 'Hints_JSON', 'Last_Active_Time', 'Owned_JSON', 'Badges_JSON', 'Pets_JSON'],
  Progress_Logs: ['Log_ID', 'Timestamp', 'Student_ID', 'Class_ID', 'Name', 'Level_ID', 'Stars', 'Gold_Earned', 'Is_First_Clear', 'Steps', 'Accuracy', 'Fails', 'Work_JSON'],
  Levels: ['Level_ID', 'World_ID', 'Order', 'Title', 'Kind', 'Tools', 'Pass', 'Star3_Steps', 'NPC_Dialogue', 'Hint', 'Phases_JSON'],
  Live_Feed: ['Event_Time', 'Class_ID', 'Type', 'Message'],
  Admin: ['Admin_User', 'Admin_Pass', 'Teacher_Name', 'Admin_Token']
};

var WORLDS = [
  { id: 1, name: '素描教室', anti: '認識毒品', learn: '基本圖形：矩形、橢圓、直線、多邊形、選取與座標', color: '#6fae5b', ready: true },
  { id: 2, name: '調色工坊', anti: '識破偽裝', learn: '填色與框線：外框、線寬、透明度、滴管、色碼、漸層', color: '#e0a23a', ready: true },
  { id: 3, name: '構圖畫廊', anti: '拒絕技巧', learn: '變形與排列：旋轉、翻轉、複製、多選、對齊與分佈、圖層', color: '#4a9ad9', ready: true },
  { id: 4, name: '曲線畫室', anti: '勇氣與紓壓', learn: '貝茲曲線：鋼筆工具、節點工具、拖曳曲線、尖角與平滑', color: '#58a84a', ready: true },
  { id: 5, name: '節點工坊', anti: '求助與救援', learn: '路徑編輯：星形工具、物件轉路徑、插入與刪除節點、對稱節點', color: '#c0662e', ready: true },
  { id: 6, name: '宮廷畫院', anti: '承諾與行動', learn: '組合與文字：群組、相加、相減、交集、文字工具', color: '#8a6ad8', ready: true }
];
// 吹散第 n 個世界的毒霧魔王 → 晉升為 RANKS[n]
var GAME_TITLE = '拒毒萌芽小畫家';
var RANKS = ['萌芽小畫家', '識毒小畫家', '慧眼小畫家', '拒毒小畫家', '勇氣小畫家', '守護小畫家', '無毒守護畫師'];

// 經濟系統（與程式邏輯大冒險相同的公式）
var ECON = { START_GOLD: 50, BASE: 5, GROWTH: 1.12, FIRST_MULT: 5, STAR_MULT: { 1: 0.4, 2: 0.7, 3: 1 }, HINT_MULT: 2, HINT_MIN: 10 };
// 開放關卡上限：999（或舊版的 50 以上）＝全部開放
function maxLevelOf(v) { v = Number(v) || 999; return v >= 50 ? 999 : v; }
function levelReplayGold(n) { return Math.round(ECON.BASE * Math.pow(ECON.GROWTH, n - 1)); }
function hintPriceOf(n) { return Math.max(ECON.HINT_MIN, Math.round(levelReplayGold(n) * ECON.HINT_MULT)); }
function calcClearGold(n, stars, prevStars) {
  var rg = levelReplayGold(n);
  var base = Math.round(rg * ECON.STAR_MULT[stars]);
  var bonus = 0;
  if (stars > prevStars) bonus = Math.round(rg * ECON.FIRST_MULT * (ECON.STAR_MULT[stars] - (prevStars ? ECON.STAR_MULT[prevStars] : 0)));
  return base + bonus;
}
function rankOf(clearedStars, levels) {
  var r = 0;
  for (var w = 1; w <= WORLDS.length; w++) {
    var boss = (levels || []).filter(function (l) { return Number(l.world) === w && l.boss; })[0];
    if (boss && clearedStars && clearedStars[boss.id]) r = w; else break;
  }
  return r;
}

/* ---------------- 畫家造型：容貌（免費）＋畫具商店（金幣） ----------------
 * look = { skin, hairStyle, hair, eyes, hat, outfit, face, acc, brush, pet }
 * 容貌四項免費任選；其餘六格是商品代號，要先買（或免費款）才能穿。
 */
var APPEAR = {
  skin: ['#f6d3ae', '#fde3c8', '#e8b48a', '#c98d5f', '#8d5a3b'],
  hairStyle: [['short', '短髮'], ['bob', '妹妹頭'], ['long', '長髮'], ['pony', '馬尾'], ['twin', '雙馬尾'], ['bun', '包包頭'], ['curly', '捲髮'], ['spiky', '刺刺頭']],
  hair: ['#5a3b2a', '#1f1a24', '#8a5a35', '#c58a3a', '#9a4a2a', '#d8d2c8', '#e98bb4', '#5a7fd0'],
  eyes: [['dot', '圓圓眼'], ['big', '閃亮大眼'], ['smile', '笑瞇瞇'], ['wink', '眨眨眼'], ['sleepy', '睏睏眼']]
};
var SHOP_CATS = [['hat', '帽子', '🎩'], ['outfit', '服裝', '👘'], ['face', '臉部', '👓'], ['acc', '配件', '🎀'], ['brush', '畫筆', '🖌'], ['pet', '夥伴', '🐾']];
// [代號, 名稱, 價格, 需要的階級(0~6), 顏色]
var SHOP_ITEMS = (function () {
  var L = [], add = function (cat, id, name, price, rank, color) { L.push({ id: id, cat: cat, name: name, price: price, rank: rank || 0, color: color || '' }); };
  var badgeItem = function (cat, id, name, n) { add(cat, id, name, 0); L[L.length - 1].badge = n; };
  add('hat', 'hat-none', '不戴帽子', 0); badgeItem('hat', 'hat-sprout', '萌芽小帽', 10);
  [['#c0425e', '紅'], ['#4c6ef5', '藍']].forEach(function (c) { add('hat', 'beret' + c[0], c[1] + '色貝雷帽', 0, 0, c[0]); });
  [['#2f9e6e', '綠'], ['#e0a23a', '橘'], ['#7b4fc9', '紫'], ['#2a2233', '黑'], ['#f08cb0', '粉']].forEach(function (c) { add('hat', 'beret' + c[0], c[1] + '色貝雷帽', 40, 0, c[0]); });
  add('hat', 'hat-paper', '報紙摺帽', 80); add('hat', 'hat-cat', '貓耳朵', 150); add('hat', 'hat-straw', '寫生草帽', 300);
  add('hat', 'hat-top', '紳士高帽', 1500); add('hat', 'hat-flower', '花環', 1800); add('hat', 'hat-plume', '羽毛大帽', 5000, 2);
  add('hat', 'hat-wizard', '星星巫師帽', 6000, 2); add('hat', 'hat-grad', '學士帽', 10000, 3); add('hat', 'hat-laurel', '月桂冠', 20000, 5); add('hat', 'hat-crown', '宮廷王冠', 80000, 6);
  [['#4c6ef5', '藍'], ['#e0627a', '紅']].forEach(function (c) { add('outfit', 'smock' + c[0], c[1] + '色罩衫', 0, 0, c[0]); });
  [['#58a84a', '綠'], ['#f2c14e', '黃'], ['#8a5a35', '咖啡'], ['#f3ecdf', '米白'], ['#7b4fc9', '紫']].forEach(function (c) { add('outfit', 'smock' + c[0], c[1] + '色罩衫', 40, 0, c[0]); });
  badgeItem('outfit', 'out-guard', '無毒守護披風', 40);
  add('outfit', 'out-hoodie', '連帽衫', 400); add('outfit', 'out-apron', '顏料圍裙', 350); add('outfit', 'out-sailor', '水手服', 450); add('outfit', 'out-overall', '吊帶褲', 500);
  add('outfit', 'out-blazer', '學院制服', 2000); add('outfit', 'out-robe', '星空長袍', 7000, 2); add('outfit', 'out-cape', '大師披風', 25000, 4); add('outfit', 'out-royal', '宮廷禮服', 100000, 6);
  add('face', 'face-none', '什麼都不戴', 0); add('face', 'face-glass', '圓框眼鏡', 60); add('face', 'face-heart', '愛心貼紙', 120); add('face', 'face-mous', '畫家小鬍子', 350);
  add('face', 'face-sun', '酷酷墨鏡', 400); add('face', 'face-mono', '單片眼鏡', 1200); add('face', 'face-mask', '舞會面具', 9000, 3);
  add('acc', 'acc-none', '什麼都不戴', 0); badgeItem('acc', 'acc-shield', '拒毒盾牌', 25); add('acc', 'acc-bow', '紅色領結', 60); add('acc', 'acc-pin', '花朵髮夾', 90); add('acc', 'acc-scarf', '條紋圍巾', 300);
  add('acc', 'acc-pencil', '耳後鉛筆', 250); add('acc', 'acc-palette', '調色盤', 1300); add('acc', 'acc-medal', '學院勳章', 1500, 1); add('acc', 'acc-ribbon', '宮廷綬帶', 30000, 5);
  add('brush', 'brush-basic', '基本畫筆', 0); add('brush', 'brush-pencil', '大鉛筆', 120); add('brush', 'brush-crayon', '粗蠟筆', 150); add('brush', 'brush-quill', '羽毛筆', 500);
  add('brush', 'brush-roller', '油漆滾筒', 1600); add('brush', 'brush-rainbow', '彩虹畫筆', 6000, 2); add('brush', 'brush-wand', '魔法筆杖', 9000, 3); add('brush', 'brush-giant', '巨無霸畫筆', 18000, 4); add('brush', 'brush-gold', '黃金畫筆', 60000, 6);
  add('pet', 'pet-none', '不帶夥伴', 0);
  badgeItem('pet', 'pet-sprout', '萌芽精靈', 48); add('pet', 'pet-chick', '小黃雞', 180); add('pet', 'pet-cat', '小花貓', 600); add('pet', 'pet-dog', '小柴犬', 600); add('pet', 'pet-bunny', '小白兔', 800);
  add('pet', 'pet-owl', '貓頭鷹', 2500, 1); add('pet', 'pet-swan', '學院天鵝', 3000, 2); add('pet', 'pet-blot', '墨漬寶寶', 8000, 3); add('pet', 'pet-dragon', '彩墨小龍', 40000, 4); add('pet', 'pet-unicorn', '宮廷獨角獸', 120000, 6);
  return L;
})();
var SHOP_MAP = {}; SHOP_ITEMS.forEach(function (it) { SHOP_MAP[it.id] = it; });
var LOOK_SLOTS = ['hat', 'outfit', 'face', 'acc', 'brush', 'pet'];
var DEFAULT_LOOK = { skin: '#f6d3ae', hairStyle: 'short', hair: '#5a3b2a', eyes: 'dot', hat: 'beret#c0425e', outfit: 'smock#4c6ef5', face: 'face-none', acc: 'acc-none', brush: 'brush-basic', pet: 'pet-none' };
function ownsItem(owned, id) { var it = SHOP_MAP[id]; return !!it && ((it.price === 0 && !it.badge) || (owned || []).indexOf(id) >= 0); }
/** 檢查造型；owned 給 null 表示不檢查是否擁有（只顯示用） */
function normalizeLook(lk, owned) {
  lk = lk || {};
  if (lk.beret && !lk.hat) lk = Object.assign({}, lk, { hat: 'beret' + lk.beret, outfit: 'smock' + (lk.smock || '#4c6ef5') });
  var out = {}, opt = function (k) { return APPEAR[k].map(function (x) { return typeof x === 'string' ? x : x[0]; }); };
  ['skin', 'hairStyle', 'hair', 'eyes'].forEach(function (k) { out[k] = opt(k).indexOf(lk[k]) >= 0 ? lk[k] : DEFAULT_LOOK[k]; });
  LOOK_SLOTS.forEach(function (k) { var it = SHOP_MAP[lk[k]]; out[k] = it && it.cat === k && (owned === null || owned === undefined ? true : ownsItem(owned, it.id)) ? it.id : DEFAULT_LOOK[k]; });
  if (lk.petStage > 1 && out.pet !== 'pet-none') out.petStage = Math.min(3, lk.petStage | 0);
  return out;
}

/* ---------------- 夥伴進化 ----------------
 * 帶著夥伴答對拒毒問答（第一次作答或複習都算，同一題每隻夥伴只算一次），夥伴得到 1 點成長值。
 * 成長值 6 點進化成第二階、18 點進化成第三階。 */
var PET_EVO = [0, 6, 18];
var PET_NAMES = {
  'pet-sprout': ['萌芽精靈', '花苞精靈', '花冠精靈'], 'pet-chick': ['小黃雞', '晨光雞', '金羽鳳雛'], 'pet-cat': ['小花貓', '鈴鐺貓', '月光靈貓'],
  'pet-dog': ['小柴犬', '圍巾柴犬', '守護神犬'], 'pet-bunny': ['小白兔', '花耳兔', '雲朵月兔'], 'pet-owl': ['貓頭鷹', '博士貓頭鷹', '星空賢者梟'],
  'pet-swan': ['學院天鵝', '皇冠天鵝', '虹羽天鵝'], 'pet-blot': ['墨漬寶寶', '墨彩精靈', '彩墨魔法師'], 'pet-dragon': ['彩墨小龍', '彩翼飛龍', '虹光龍王'],
  'pet-unicorn': ['宮廷獨角獸', '彩虹獨角獸', '星翼天馬']
};
/** 夥伴圖鑑的介紹（每種三階） */
var PET_INFO = {
  'pet-sprout': ['從拒毒徽章裡誕生的小精靈，最喜歡乾淨的空氣和陽光。', '頭上長出了花苞。聽到有人勇敢說「不」，花苞就會輕輕發光。', '花開了！牠飛過的地方，灰霾的毒霧都會散開。'],
  'pet-chick': ['圓滾滾的小黃雞，看到不明的東西會先躲到你腳邊。', '長出紅色的冠和翅膀，每天早上提醒你：不碰、不吃、不聞！', '傳說中的鳳凰雛鳥，尾羽像火焰，能照亮被毒霧遮住的路。'],
  'pet-cat': ['愛撒嬌的小花貓，鼻子很靈，聞得出可疑的味道。', '戴上了鈴鐺。有陌生人靠近時，鈴鐺會叮叮響。', '長出雙尾和月光翅膀，夜裡也能看清楚偽裝的陷阱。'],
  'pet-dog': ['忠心的小柴犬，總是陪你走安全的路回家。', '圍上紅圍巾，會擋在你和可疑的人中間。', '戴著金冠的守護神犬，張開翅膀保護所有的朋友。'],
  'pet-bunny': ['膽小的小白兔，耳朵很長，聽得見朋友的求救聲。', '耳朵上別了一朵花，學會大聲說「我不要」。', '長出翅膀的月兔，帶著需要幫助的朋友去找可以信任的大人。'],
  'pet-owl': ['安靜的貓頭鷹，喜歡在晚上讀反毒小手冊。', '戴上博士帽和眼鏡，分得出糖果和偽裝的毒品。', '披著星空披風的賢者，把拒毒的知識教給每一個人。'],
  'pet-swan': ['學院湖上的小天鵝，優雅又有禮貌地拒絕不好的邀請。', '戴上皇冠、張開翅膀，被同學起鬨也不會動搖。', '羽尖閃著彩虹的天鵝，提醒大家：健康的生活最美麗。'],
  'pet-blot': ['從墨水瓶跑出來的墨漬寶寶，本來是灰霾的小跟班，後來變成你的朋友。', '戴上小皇冠、長出彩色翅膀，把灰色的地方塗回顏色。', '學會魔法的彩墨魔法師，一揮筆就能畫出無毒的彩虹。'],
  'pet-dragon': ['愛畫畫的彩墨小龍，背上有三個顏色的鱗片。', '翅膀長大了，可以載著你飛過毒霧。', '頭戴金冠的虹光龍王，一聲吼叫就能吹散灰霾。'],
  'pet-unicorn': ['只在宮廷畫院出現的獨角獸，角會發出溫柔的光。', '鬃毛變成彩虹色，角上的星星能找出躲起來的謊言。', '長出翅膀的星翼天馬，載著無毒世界的希望飛向天空。']
};
/** 圖鑑解鎖了幾個（擁有夥伴＝第一階；成長到哪一階就解鎖到哪一階） */
function petDexCount(owned, pets) { var n = 0; Object.keys(PET_NAMES).forEach(function (id) { if (ownsItem(owned || [], id)) n += petStageOf(petXp(pets, id)); }); return n; }
function petStageOf(xp) { return xp >= PET_EVO[2] ? 3 : xp >= PET_EVO[1] ? 2 : 1; }
function petXp(pets, id) { var a = (pets || {})[id]; return a && a.length ? a.length : 0; }
function petName(id, stage) { var n = PET_NAMES[id]; return n ? n[Math.max(1, Math.min(3, stage || 1)) - 1] : (SHOP_MAP[id] || {}).name || ''; }
/** 夥伴答對一題：回傳 { id, xp, stage, from, gained, evolved, name }，並直接更新 pets */
function petGain(pets, petId, eventId) {
  if (!petId || petId === 'pet-none' || !PET_NAMES[petId]) return null;
  var a = pets[petId] || (pets[petId] = []), from = petStageOf(a.length), gained = a.indexOf(eventId) < 0;
  if (gained) a.push(eventId);
  var st = petStageOf(a.length);
  return { id: petId, xp: a.length, stage: st, from: from, gained: gained, evolved: st > from, name: petName(petId, st), fromName: petName(petId, from) };
}
/** 把夥伴目前的階段寫進造型（給畫面用；存檔時不存） */
function lookStage(look, pets) { var lk = Object.assign({}, look); delete lk.petStage; var st = lk.pet && lk.pet !== 'pet-none' ? petStageOf(petXp(pets, lk.pet)) : 1; if (st > 1) lk.petStage = st; return lk; }

/* ---------------- 向量物件幾何 ----------------
 * rect / ellipse：{t, x, y, w, h}
 * line：{t, pts:[[x1,y1],[x2,y2]]}
 * poly：{t, pts:[[x,y],...]}（封閉）
 * path：{t, nodes:[{x,y,i:[dx,dy]|null,o:[dx,dy]|null,s}], closed}
 * 共同：fill、stroke、sw（線寬）
 * ---------------------------------------------- */
var INK = '#2a2233';
var KAPPA = 0.5522847498;
function r1(v) { return Math.round(v * 10) / 10; }
function isGrad(f) { return !!f && typeof f === 'object'; }
function fillColorOf(f) { return isGrad(f) ? f.c[0] : (f || 'none'); }
function cloneObj(o) { return JSON.parse(JSON.stringify(o)); }
// 文字寬度（不靠瀏覽器量測，前後端一致）：中文字算 1 個字寬，英數算 0.58
function textWidth(s, size) { var w = 0; String(s || '').split('').forEach(function (ch) { w += /[\u2e80-\uffff]/.test(ch) ? size : size * 0.58; }); return w; }
function segD(a, b) {
  var c1 = a.o ? [a.x + a.o[0], a.y + a.o[1]] : [a.x, a.y], c2 = b.i ? [b.x + b.i[0], b.y + b.i[1]] : [b.x, b.y];
  return 'C' + r1(c1[0]) + ' ' + r1(c1[1]) + ' ' + r1(c2[0]) + ' ' + r1(c2[1]) + ' ' + r1(b.x) + ' ' + r1(b.y);
}
function objD(o) {
  if (!o) return '';
  if (o.t === 'rect') return 'M' + r1(o.x) + ' ' + r1(o.y) + 'H' + r1(o.x + o.w) + 'V' + r1(o.y + o.h) + 'H' + r1(o.x) + 'Z';
  if (o.t === 'ellipse') {
    var rx = o.w / 2, ry = o.h / 2, cx = o.x + rx, cy = o.y + ry;
    return 'M' + r1(cx - rx) + ' ' + r1(cy) + 'A' + r1(rx) + ' ' + r1(ry) + ' 0 1 0 ' + r1(cx + rx) + ' ' + r1(cy) + 'A' + r1(rx) + ' ' + r1(ry) + ' 0 1 0 ' + r1(cx - rx) + ' ' + r1(cy) + 'Z';
  }
  if (o.t === 'line') return 'M' + r1(o.pts[0][0]) + ' ' + r1(o.pts[0][1]) + 'L' + r1(o.pts[1][0]) + ' ' + r1(o.pts[1][1]);
  if (o.t === 'poly') return o.pts.map(function (p, k) { return (k ? 'L' : 'M') + r1(p[0]) + ' ' + r1(p[1]); }).join('') + 'Z';
  if (o.t === 'compound') return (o.rings || []).map(function (rg) { return rg.map(function (p, k) { return (k ? 'L' : 'M') + r1(p[0]) + ' ' + r1(p[1]); }).join('') + 'Z'; }).join('');
  if (o.t === 'path') {
    var n = o.nodes; if (!n || !n.length) return '';
    var d = 'M' + r1(n[0].x) + ' ' + r1(n[0].y);
    for (var k = 1; k < n.length; k++) d += segD(n[k - 1], n[k]);
    if (o.closed && n.length > 1) d += segD(n[n.length - 1], n[0]) + 'Z';
    return d;
  }
  return '';
}
function bezPt(a, b, t) {
  var p0 = [a.x, a.y], p1 = a.o ? [a.x + a.o[0], a.y + a.o[1]] : p0, p3 = [b.x, b.y], p2 = b.i ? [b.x + b.i[0], b.y + b.i[1]] : p3, u = 1 - t;
  return [0, 1].map(function (c) { return u * u * u * p0[c] + 3 * u * u * t * p1[c] + 3 * u * t * t * p2[c] + t * t * t * p3[c]; });
}
function pathPoints(o, per) {   // 把曲線切成折線（外框計算、布林運算用）
  var n = o.nodes, out = [], cnt = o.closed ? n.length : n.length - 1;
  if (!n.length) return out; out.push([n[0].x, n[0].y]);
  for (var k = 0; k < cnt; k++) { var a = n[k], b = n[(k + 1) % n.length]; for (var j = 1; j <= per; j++) out.push(bezPt(a, b, j / per)); }
  if (o.closed) out.pop();
  return out;
}
function objBBox(o) {
  if (o.t === 'rect' || o.t === 'ellipse') return { x: o.x, y: o.y, w: o.w, h: o.h };
  if (o.t === 'text') return { x: o.x, y: o.y - o.size * 0.88, w: textWidth(o.text, o.size), h: o.size * 1.12 };
  if (o.t === 'group') return bboxUnion((o.items || []).map(objBBox));
  var pts = o.pts || (o.t === 'path' ? pathPoints(o, 8) : []);
  if (o.t === 'compound') pts = [].concat.apply([], o.rings || []);
  if (!pts.length) return { x: 0, y: 0, w: 0, h: 0 };
  var xs = pts.map(function (p) { return p[0]; }), ys = pts.map(function (p) { return p[1]; });
  var x0 = Math.min.apply(null, xs), y0 = Math.min.apply(null, ys);
  return { x: x0, y: y0, w: Math.max.apply(null, xs) - x0, h: Math.max.apply(null, ys) - y0 };
}
function bboxUnion(list) {
  if (!list.length) return { x: 0, y: 0, w: 0, h: 0 };
  var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  list.forEach(function (b) { x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); });
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
// 對所有座標套用 f(點) 與 g(向量)；矩形、橢圓、文字要另外處理
function xformPts(o, f, g) {
  if (o.pts) o.pts = o.pts.map(f);
  if (o.rings) o.rings = o.rings.map(function (r) { return r.map(f); });
  if (o.nodes) o.nodes.forEach(function (n) { var p = f([n.x, n.y]); n.x = p[0]; n.y = p[1]; if (n.i) n.i = g(n.i); if (n.o) n.o = g(n.o); });
  if (o.items) o.items.forEach(function (c) { xformPts(c, f, g); if (c.t === 'rect' || c.t === 'ellipse' || c.t === 'text') { var p = f([c.x, c.y]); c.x = p[0]; c.y = p[1]; } });
  return o;
}
function moveObj(o, dx, dy) {
  if (o.t === 'rect' || o.t === 'ellipse' || o.t === 'text') { o.x += dx; o.y += dy; return o; }
  return xformPts(o, function (p) { return [p[0] + dx, p[1] + dy]; }, function (v) { return v; });
}
function fitObj(o, a, b) {
  var sx = a.w ? b.w / a.w : 1, sy = a.h ? b.h / a.h : 1;
  var mx = function (x) { return a.w ? b.x + (x - a.x) * sx : x + (b.x - a.x); }, my = function (y) { return a.h ? b.y + (y - a.y) * sy : y + (b.y - a.y); };
  if (o.t === 'group') { o.items.forEach(function (c) { var cb = objBBox(c); fitObj(c, cb, { x: mx(cb.x), y: my(cb.y), w: cb.w * sx, h: cb.h * sy }); }); return o; }
  if (o.t === 'rect' || o.t === 'ellipse') { o.x = mx(o.x); o.y = my(o.y); o.w = o.w * sx; o.h = o.h * sy; return o; }
  if (o.t === 'text') { var bb = objBBox(o), ns = Math.max(6, o.size * sy); o.size = Math.round(ns); o.x = mx(bb.x); o.y = my(bb.y) + o.size * 0.88; return o; }
  return xformPts(o, function (p) { return [mx(p[0]), my(p[1])]; }, function (v) { return [v[0] * sx, v[1] * sy]; });
}
function rectToPoly(o) { var p = cloneObj(o); p.t = 'poly'; p.pts = [[o.x, o.y], [o.x + o.w, o.y], [o.x + o.w, o.y + o.h], [o.x, o.y + o.h]]; delete p.x; delete p.y; delete p.w; delete p.h; return p; }
// 物件轉路徑（Inkscape：Shift+Ctrl+C）
function toPath(o) {
  var p = cloneObj(o), N = function (x, y) { return { x: x, y: y, i: null, o: null, s: 0 }; };
  if (o.t === 'path') return p;
  if (o.t === 'rect') { p.nodes = [N(o.x, o.y), N(o.x + o.w, o.y), N(o.x + o.w, o.y + o.h), N(o.x, o.y + o.h)]; p.closed = true; }
  else if (o.t === 'ellipse') {
    var rx = o.w / 2, ry = o.h / 2, cx = o.x + rx, cy = o.y + ry, kx = rx * KAPPA, ky = ry * KAPPA;
    p.nodes = [{ x: cx, y: cy - ry, i: [-kx, 0], o: [kx, 0], s: 2 }, { x: cx + rx, y: cy, i: [0, -ky], o: [0, ky], s: 2 }, { x: cx, y: cy + ry, i: [kx, 0], o: [-kx, 0], s: 2 }, { x: cx - rx, y: cy, i: [0, ky], o: [0, -ky], s: 2 }]; p.closed = true;
  }
  else if (o.t === 'poly') { p.nodes = o.pts.map(function (q) { return N(q[0], q[1]); }); p.closed = true; }
  else if (o.t === 'line') { p.nodes = o.pts.map(function (q) { return N(q[0], q[1]); }); p.closed = false; }
  else return null;
  p.t = 'path'; ['x', 'y', 'w', 'h', 'pts'].forEach(function (k) { delete p[k]; });
  return p;
}
function rotateObj(o, deg, cx, cy) {
  var rad = deg * Math.PI / 180, c = Math.cos(rad), s = Math.sin(rad);
  var f = function (p) { var dx = p[0] - cx, dy = p[1] - cy; return [cx + dx * c - dy * s, cy + dx * s + dy * c]; };
  var g = function (v) { return [v[0] * c - v[1] * s, v[0] * s + v[1] * c]; };
  if (o.t === 'text') { var q = f([o.x, o.y]); o.x = q[0]; o.y = q[1]; return o; }
  if (o.t === 'group') { o.items = o.items.map(function (it) { return rotateObj(it, deg, cx, cy); }); return o; }
  if (o.t === 'rect' || o.t === 'ellipse') {
    var q90 = ((Math.round(deg) % 360) + 360) % 360;
    if (q90 % 90 === 0) { var m = f([o.x + o.w / 2, o.y + o.h / 2]), sw = q90 % 180 !== 0; var w = sw ? o.h : o.w, h = sw ? o.w : o.h; o.x = m[0] - w / 2; o.y = m[1] - h / 2; o.w = w; o.h = h; return o; }
    o = o.t === 'rect' ? rectToPoly(o) : toPath(o);
  }
  return xformPts(o, f, g);
}
function flipObj(o, axis, c) {
  var h = axis === 'h';
  var f = function (p) { return h ? [2 * c - p[0], p[1]] : [p[0], 2 * c - p[1]]; }, g = function (v) { return h ? [-v[0], v[1]] : [v[0], -v[1]]; };
  if (o.t === 'group') { o.items = o.items.map(function (it) { return flipObj(it, axis, c); }); return o; }
  if (o.t === 'rect' || o.t === 'ellipse') { if (h) o.x = 2 * c - o.x - o.w; else o.y = 2 * c - o.y - o.h; return o; }
  if (o.t === 'text') { if (h) o.x = 2 * c - o.x - textWidth(o.text, o.size); return o; }
  return xformPts(o, f, g);
}
// 節點變平滑：沿前後節點的方向拉出把手（Inkscape：Shift+S）
function smoothNode(o, k, sym) {
  var nodes = o.nodes, n = nodes[k], len = nodes.length, cl = o.closed;
  var prev = nodes[k - 1] || (cl ? nodes[len - 1] : n), next = nodes[k + 1] || (cl ? nodes[0] : n);
  var tx = next.x - prev.x, ty = next.y - prev.y, tl = Math.hypot(tx, ty) || 1;
  var d1 = Math.hypot(n.x - prev.x, n.y - prev.y), d2 = Math.hypot(next.x - n.x, next.y - n.y);
  var h1 = (sym ? (d1 + d2) / 2 : d1) / 3, h2 = (sym ? (d1 + d2) / 2 : d2) / 3;
  n.i = [-tx / tl * h1, -ty / tl * h1]; n.o = [tx / tl * h2, ty / tl * h2]; n.s = sym ? 2 : 1;
  return o;
}
function symNode(n) {
  var li = n.i ? Math.hypot(n.i[0], n.i[1]) : 0, lo = n.o ? Math.hypot(n.o[0], n.o[1]) : 0, L = (li + lo) / 2;
  var d = lo ? [n.o[0] / lo, n.o[1] / lo] : li ? [-n.i[0] / li, -n.i[1] / li] : null;
  if (!d) return false;
  n.o = [d[0] * L, d[1] * L]; n.i = [-d[0] * L, -d[1] * L]; n.s = 2; return true;
}
function splitPathSeg(o, k, t) {
  var nodes = o.nodes, a = nodes[k], b = nodes[(k + 1) % nodes.length];
  var L = function (p, q) { return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]; };
  var p0 = [a.x, a.y], p1 = a.o ? [a.x + a.o[0], a.y + a.o[1]] : p0, p3 = [b.x, b.y], p2 = b.i ? [b.x + b.i[0], b.y + b.i[1]] : p3;
  var curved = !!(a.o || b.i);
  var q0 = L(p0, p1), q1 = L(p1, p2), q2 = L(p2, p3), r0 = L(q0, q1), r1_ = L(q1, q2), s = L(r0, r1_);
  var rel = function (v, c) { var d = [v[0] - c[0], v[1] - c[1]]; return (Math.abs(d[0]) > 0.01 || Math.abs(d[1]) > 0.01) ? d : null; };
  var nn = { x: s[0], y: s[1], i: curved ? rel(r0, s) : null, o: curved ? rel(r1_, s) : null, s: curved ? 1 : 0 };
  if (curved) { a.o = rel(q0, p0); b.i = rel(q2, p3); }
  nodes.splice(k + 1, 0, nn);
  return k + 1;
}
// 星形／多邊形工具（Inkscape：*）
function starPts(cx, cy, r, n, ratio, rotDeg, isStar) {
  var pts = [], a0 = rotDeg * Math.PI / 180, cnt = isStar ? n * 2 : n;
  for (var i = 0; i < cnt; i++) { var a = a0 + i * 2 * Math.PI / cnt, rr = isStar && i % 2 ? r * ratio : r; pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]); }
  return pts;
}
var TYPE_NAMES = { rect: '矩形', ellipse: '橢圓', line: '直線', poly: '多邊形', path: '路徑', compound: '組合路徑', group: '群組', text: '文字' };
function countTypes(objs, cnt) {
  cnt = cnt || { _n: 0 };
  (objs || []).forEach(function (o) { if (!o) return; cnt[o.t] = (cnt[o.t] || 0) + 1; cnt._n++; if (o.t === 'group') countTypes(o.items, cnt); });
  return cnt;
}
function flatObjs(objs, out) { out = out || []; (objs || []).forEach(function (o) { if (o.t === 'group') flatObjs(o.items, out); else out.push(o); }); return out; }

/* ---------------- 過關規則（前後端共用） ----------------
 * require：{ rect: 2 } 至少要有幾個某種物件（群組裡的也算）
 * text：['皇家畫家學院'] 畫面上一定要有的文字
 * creative：{ types: 3, colors: 2, text: true, group: true } 創作關的規準
 * ------------------------------------------------------ */
function checkRules(objs, rules) {
  rules = rules || {};
  if (!Array.isArray(objs) || !objs.length) return { ok: false, msg: '畫布上還沒有任何圖形。' };
  var cnt = countTypes(objs), max = rules.maxObjects || 80;
  if (cnt._n > max) return { ok: false, msg: '物件太多了，最多 ' + max + ' 個。' };
  for (var k in cnt) if (k !== '_n' && !TYPE_NAMES[k]) return { ok: false, msg: '作品裡有無法辨識的物件。' };
  var hasR = rules.has || [], flatAll = flatObjs(objs);
  for (var hi = 0; hi < hasR.length; hi++) {
    var hr = hasR[hi], okH = flatAll.some(function (o) {
      if (hr.t && o.t !== hr.t) return false;
      if (hr.dash != null && (o.dash || 0) !== hr.dash) return false;
      if (hr.stroke && String(o.stroke || '').toLowerCase() !== hr.stroke.toLowerCase()) return false;
      if (hr.sw != null && Number(o.sw) !== hr.sw) return false;
      if (hr.grad && !(o.fill && typeof o.fill === 'object' && o.fill.g === hr.grad)) return false;
      return true;
    });
    if (!okH) return { ok: false, msg: hr.msg || '還有設定沒有完成。' };
  }
  var req = rules.require || {};
  for (var t in req) if ((cnt[t] || 0) < req[t]) return { ok: false, msg: '這一關要用到 ' + req[t] + ' 個「' + TYPE_NAMES[t] + '」，目前只有 ' + (cnt[t] || 0) + ' 個。' };
  var flat = flatObjs(objs);
  var texts = flat.filter(function (o) { return o.t === 'text'; }).map(function (o) { return String(o.text || '').trim(); });
  for (var i = 0; i < (rules.text || []).length; i++) if (texts.indexOf(rules.text[i]) < 0) return { ok: false, msg: '畫面上要有文字「' + rules.text[i] + '」。' };
  var cr = rules.creative;
  if (cr) {
    var types = {}, cols = {};
    flat.forEach(function (o) { if (o.t !== 'text') types[o.t] = 1; var f = fillColorOf(o.fill); if (f && f !== 'none') cols[String(f).toLowerCase()] = 1; if (o.t === 'line' && o.stroke) cols[String(o.stroke).toLowerCase()] = 1; if (isGrad(o.fill)) cols[String(o.fill.c[1]).toLowerCase()] = 1; });
    if (Object.keys(types).length < (cr.types || 0)) return { ok: false, msg: '創作規準：至少要用 ' + cr.types + ' 種不同的圖形（目前 ' + Object.keys(types).length + ' 種）。' };
    if (Object.keys(cols).length < (cr.colors || 0)) return { ok: false, msg: '創作規準：至少要用 ' + cr.colors + ' 種顏色（目前 ' + Object.keys(cols).length + ' 種）。' };
    if (cr.text && !texts.some(function (s) { return s.length; })) return { ok: false, msg: '創作規準：作品裡要有一段文字（例如作品名稱）。' };
    if (cr.textHas && !texts.some(function (s) { return cr.textHas.some(function (w) { return s.indexOf(w) >= 0; }); })) return { ok: false, msg: '創作規準：標語裡要有「' + cr.textHas.join('」或「') + '」字。' };
    if (cr.group && !cnt.group) return { ok: false, msg: '創作規準：至少要把幾個圖形組成一個群組（Ctrl+G）。' };
  }
  return { ok: true, msg: '' };
}

/* ---------------- 關卡資料 ---------------- */
var C = { red: '#e0627a', orange: '#f2a65a', yellow: '#f2d14e', green: '#6fae5b', blue: '#5aa7e0', purple: '#9b7ad8', brown: '#8a5a35', white: '#ffffff', ink: '#2a2233', sky: '#bfe3f3' };
function R(x, y, w, h, fill) { return { t: 'rect', x: x, y: y, w: w, h: h, fill: fill, stroke: INK, sw: 4 }; }
function E(x, y, w, h, fill) { return { t: 'ellipse', x: x, y: y, w: w, h: h, fill: fill, stroke: INK, sw: 4 }; }
function Ln(x1, y1, x2, y2, col, sw) { return { t: 'line', pts: [[x1, y1], [x2, y2]], fill: 'none', stroke: col, sw: sw || 8 }; }
function P(pts, fill) { return { t: 'poly', pts: pts, fill: fill, stroke: INK, sw: 4 }; }

var HOUSE = [R(180, 300, 240, 180, C.orange), P([[150, 300], [300, 170], [450, 300]], C.red), R(270, 380, 60, 100, C.brown)];
var MOUNTAIN_FLAG = [P([[60, 480], [300, 160], [540, 480]], C.purple), Ln(300, 160, 300, 60, C.ink, 8), P([[300, 60], [400, 90], [300, 120]], C.red)];
var TRAFFIC = [R(230, 80, 140, 400, C.ink), E(260, 100, 80, 80, C.red), E(260, 240, 80, 80, C.yellow), E(260, 380, 80, 80, C.green)];

var LEVELS = [
  { id: 'W1-01', world: 1, title: '第一張畫布', kind: '臨摹', tools: ['select', 'rect'], palette: [C.blue], pass: 0.9, star3: 1,
    npc: '歡迎來到皇家畫家學院！先用【矩形】在虛線的位置按住拖曳，畫出一張藍色的畫布。',
    hint: '從虛線的左上角按住，一路拖到右下角再放開。格線會幫你對齊。',
    phases: [{ name: '藍色畫布', target: [R(150, 150, 300, 300, C.blue)], start: null, rules: { require: { rect: 1 } } }] },
  { id: 'W1-02', world: 1, title: '搬錯位置的畫框', kind: '修圖', tools: ['select'], palette: [C.orange], pass: 0.9, star3: 2,
    npc: '工友把畫框放錯地方，大小也不對。用【選取】拖曳框框移動它，再拉角落的小方塊調整大小。',
    hint: '先把畫框拖到虛線的左上角，再拉右下角的小方塊，讓它和虛線一樣大。',
    phases: [{ name: '畫框', target: [R(200, 220, 300, 240, C.orange)], start: [R(60, 60, 160, 120, C.orange)], rules: { require: { rect: 1 } } }] },
  { id: 'W1-03', world: 1, title: '午後的太陽', kind: '臨摹', tools: ['select', 'ellipse', 'rect'], palette: [C.yellow, C.green], pass: 0.9, star3: 1,
    npc: '畫一顆太陽吧！先在右邊調色盤點【黃色】，再用【橢圓】拖出一個圓。',
    hint: '先選顏色再畫，就不用事後改顏色，可以少一個步驟。',
    phases: [{ name: '太陽', target: [R(0, 420, 600, 180, C.green), E(360, 90, 160, 160, C.yellow)], start: [R(0, 420, 600, 180, C.green)], rules: { require: { ellipse: 1 } } }] },
  { id: 'W1-04', world: 1, title: '學院旁的小屋', kind: '臨摹', tools: ['select', 'rect', 'poly'], palette: [C.orange, C.red, C.brown], pass: 0.9, star3: 3,
    npc: '小屋有牆、屋頂和門。屋頂用【多邊形】：點三個角，最後點回第一個點就會封閉。',
    hint: '先畫牆，再畫門，門才會蓋在牆的上面。後畫的圖形會在前面。',
    phases: [{ name: '小屋', target: [R(0, 480, 600, 120, C.green)].concat(HOUSE), start: [R(0, 480, 600, 120, C.green)], rules: { require: { rect: 2, poly: 1 } } }] },
  { id: 'W1-05', world: 1, title: '山頂的旗子', kind: '臨摹', tools: ['select', 'line', 'poly'], palette: [C.ink, C.red, C.purple], pass: 0.9, star3: 2,
    npc: '【直線】可以畫旗桿：按住從山頂拖到上方。旗子是一個三角形，用【多邊形】畫。',
    hint: '旗桿選黑色，旗子選紅色。直線的顏色就是你在調色盤選的顏色。',
    phases: [{ name: '旗子', target: MOUNTAIN_FLAG, start: [MOUNTAIN_FLAG[0]], rules: { require: { line: 1, poly: 2 } } }] },
  { id: 'W1-06', world: 1, title: '拒毒紅綠燈', kind: '臨摹', tools: ['select', 'ellipse'], palette: [C.red, C.yellow, C.green], pass: 0.9, star3: 3,
    npc: '遇到誘惑時想想拒毒紅綠燈：紅燈「停」下來、黃燈「想」後果、綠燈「走」開去找大人。三個燈都是圓形，每畫一個之前記得先換顏色。',
    hint: '三個圓一樣大。畫好第一個之後，看右邊的寬和高數字，讓另外兩個也一樣。',
    phases: [{ name: '紅綠燈', target: TRAFFIC, start: [TRAFFIC[0]], rules: { require: { ellipse: 3 } } }] },
  { id: 'W1-07', world: 1, title: '拒毒告示牌', kind: '精準', tools: ['select'], palette: [C.blue, C.white], pass: 0.96, star3: 8,
    npc: '學院要在門口立一面拒毒告示牌，尺寸要精準：外框 X=100、Y=150、寬=400、高=300；內框 X=140、Y=190、寬=320、高=220。點選圖形後，在右邊直接輸入數字。',
    hint: '點一下藍色外框，把右邊四個數字改成 100、150、400、300；再點白色內框改成 140、190、320、220。',
    phases: [{ name: '畫框', target: [R(100, 150, 400, 300, C.blue), R(140, 190, 320, 220, C.white)], start: [R(60, 100, 380, 330, C.blue), R(170, 230, 250, 150, C.white)], rules: { require: { rect: 2 } } }] },
  { id: 'W1-08', world: 1, title: '歪掉的路燈', kind: '修圖', tools: ['select'], palette: [C.ink, C.yellow], pass: 0.9, star3: 2,
    npc: '有人惡作劇：燈柱被搬走了，燈泡也被塗黑。把燈柱搬回燈座上方，再把燈泡改成黃色。',
    hint: '改顏色：先點選燈泡，再點調色盤的黃色。',
    phases: [{ name: '路燈', target: [R(285, 200, 30, 280, C.ink), E(250, 110, 100, 100, C.yellow), R(240, 470, 120, 20, C.ink)],
      start: [R(75, 260, 30, 280, C.ink), E(250, 110, 100, 100, C.ink), R(240, 470, 120, 20, C.ink)], rules: { require: { rect: 2, ellipse: 1 } } }] },
  { id: 'W1-09', world: 1, title: '冬天的雪人', kind: '臨摹', tools: ['select', 'ellipse', 'line', 'poly'], palette: [C.white, C.brown, C.orange], pass: 0.88, star3: 6,
    npc: '堆一個雪人：三個白色的圓由大到小，兩隻樹枝手用【直線】，鼻子是橘色的三角形。',
    hint: '從最下面的大圓開始畫，最後畫鼻子，鼻子才不會被頭蓋住。',
    phases: [{ name: '雪人', target: [R(0, 500, 600, 100, C.sky), E(200, 330, 200, 200, C.white), E(230, 210, 140, 140, C.white), E(260, 130, 80, 80, C.white), Ln(240, 280, 140, 220, C.brown, 8), Ln(360, 280, 460, 220, C.brown, 8), P([[300, 160], [340, 170], [300, 180]], C.orange)],
      start: [R(0, 500, 600, 100, C.sky)], rules: { require: { ellipse: 3, line: 2, poly: 1 } } }] },
  { id: 'W1-10', world: 1, title: '灰霾・素描對決', kind: '世界王', boss: true, tools: ['select', 'rect', 'ellipse', 'line', 'poly'], palette: [C.orange, C.red, C.brown, C.ink, C.purple, C.yellow, C.green], pass: 0.88, star3: 11,
    npc: '毒霧魔王「灰霾」想用毒霧把學院染成灰色！連續畫出三幅畫：小屋、山頂的旗子、紅綠燈。每完成一幅，就能吹散一些毒霧。',
    hint: '三幅都是這個世界畫過的作品，照之前的順序畫就可以了。',
    phases: [
      { name: '小屋', target: HOUSE, start: null, rules: { require: { rect: 2, poly: 1 } }, say: '「一間小屋而已？我先讓你畫。」' },
      { name: '山頂的旗子', target: MOUNTAIN_FLAG, start: null, rules: { require: { line: 1, poly: 2 } }, say: '「還撐得住嗎……」' },
      { name: '紅綠燈', target: TRAFFIC, start: null, rules: { require: { rect: 1, ellipse: 3 } }, say: '「不……我的毒霧……！」' }
    ] }
];

/* ======================= 第二～六世界（Inkscape 功能） ======================= */
var K2 = { gold: '#d4a843', pink: '#f7a1c4', sun: '#ffd84d', grey: '#b8b2c2', navy: '#2c3e7a', sea: '#3f7fd0', cream: '#fbf3e0', peach: '#ffb35c', violet: '#7b4fc9', wall: '#efe6d6', ice: '#cfe8ff' };
function Rn(x, y, w, h, fill) { var o = R(x, y, w, h, fill); o.stroke = 'none'; return o; }
function BG(fill) { var o = Rn(0, 0, 600, 600, fill); o.lock = true; return o; }   // 鎖定的背景（框選與全選不會選到）
function W_(o, props) { var c = cloneObj(o); for (var k in props) c[k] = props[k]; return c; }
function PN(x, y, i, o, s) { return { x: x, y: y, i: i || null, o: o || null, s: s || 0 }; }
function PATH(nodes, closed, fill, stroke, sw) { return { t: 'path', nodes: nodes, closed: closed !== false, fill: fill, stroke: stroke || INK, sw: sw == null ? 4 : sw }; }
function ROT(o, d, cx, cy) { return rotateObj(cloneObj(o), d, cx, cy); }
function FLIP(o, axis, c) { return flipObj(cloneObj(o), axis, c); }
function MOVE(o, dx, dy) { return moveObj(cloneObj(o), dx, dy); }
function BOOL(op, items, extra) { var b = { t: 'bool', op: op, items: items }; for (var k in (extra || {})) b[k] = extra[k]; return b; }
function STAR(cx, cy, r, n, ratio, isStar, fill) { return P(starPts(cx, cy, r, n, ratio, -90, isStar), fill); }
function TXT(x, y, text, size, fill) { return { t: 'text', x: x, y: y, text: text, size: size, fill: fill, stroke: 'none', sw: 0 }; }

var ACC = ['select', 'rect', 'ellipse', 'line', 'poly'];
function addWorld(w, defs) {
  defs.forEach(function (d, i) {
    (d.learn || []).forEach(function (t) { if (ACC.indexOf(t) < 0) ACC.push(t); });
    d.tools = ACC.slice(); d.world = w; d.id = 'W' + w + '-' + String(i + 1).padStart(2, '0'); d.pass = d.pass || 0.9;
    LEVELS.push(d);
  });
}

/* ---------- 第二世界：調色工坊 ---------- */
var FRUIT_T = [R(0, 430, 600, 170, C.brown), E(150, 250, 130, 130, C.red), E(320, 250, 130, 130, C.orange), E(235, 190, 130, 150, C.green), E(110, 330, 380, 150, K2.cream)];
var FRUIT_S = FRUIT_T.map(function (o, i) { return i >= 1 && i <= 3 ? W_(o, { fill: K2.grey }) : cloneObj(o); });
var GLASS_S = [E(140, 150, 200, 200, C.red), E(260, 150, 200, 200, C.blue), E(200, 260, 200, 200, C.yellow)];
var GLASS_T = GLASS_S.map(function (o) { return W_(o, { op: 0.6 }); });
var SUNSET_S = [Rn(0, 0, 600, 400, K2.violet), E(240, 300, 120, 120, K2.sun), Rn(0, 400, 600, 200, K2.sea)];
var SUNSET_T = [W_(SUNSET_S[0], { fill: { g: 'lin', c: [K2.violet, K2.peach], a: 90 } }), SUNSET_S[1], SUNSET_S[2]];
addWorld(2, [
  { title: '褪色的水果盤', kind: '修圖', learn: ['fill'], palette: [C.red, C.orange, C.green, K2.grey], star3: 3,
    npc: '歡迎來到調色工坊！水果都褪成灰色了。用【選取】點一顆水果，再點下方色票條的顏色，就能替它「填色」。',
    hint: '蘋果是紅色、橘子是橘色、梨子是綠色。每顆水果點一次顏色就好。',
    phases: [{ name: '水果盤', target: FRUIT_T, start: FRUIT_S, rules: { require: { ellipse: 4 } } }] },
  { title: '金色的粗畫框', kind: '修圖', learn: ['stroke', 'width'], palette: [K2.gold, INK, C.blue], star3: 2,
    npc: '名畫的框太細了。選取藍色畫布，在右邊【填色與框線】切到「框線顏色」選金色，再到「框線樣式」把寬度改成 16。也可以按住 Shift 點色票，直接設定框線顏色。',
    hint: '只要改藍色畫布：框線顏色金色、框線寬度 16。',
    phases: [{ name: '畫框', target: [BG(K2.wall), W_(R(150, 140, 300, 240, C.blue), { stroke: K2.gold, sw: 16 }), E(330, 180, 70, 70, K2.sun), P([[170, 370], [270, 280], [370, 370]], C.green)],
      start: [BG(K2.wall), R(150, 140, 300, 240, C.blue), E(330, 180, 70, 70, K2.sun), P([[170, 370], [270, 280], [370, 370]], C.green)], rules: { require: { rect: 2 } } }] },
  { title: '沒有邊的雲', kind: '修圖', learn: ['none'], palette: [C.white, C.sky, INK], star3: 3,
    npc: '真正的雲沒有黑色外框。選取每一朵雲，在「框線顏色」按「✕ 無」，把外框拿掉。',
    hint: '三朵雲都要改。按住 Shift 點色票最左邊的 ✕，也能直接拿掉框線。',
    phases: [{ name: '雲', target: [BG(C.sky), W_(E(70, 120, 180, 90, C.white), { stroke: 'none' }), W_(E(300, 70, 200, 110, C.white), { stroke: 'none' }), W_(E(190, 300, 200, 100, C.white), { stroke: 'none' })],
      start: [BG(C.sky), E(70, 120, 180, 90, C.white), E(300, 70, 200, 110, C.white), E(190, 300, 200, 100, C.white)], rules: { require: { ellipse: 3 } } }] },
  { title: '三色玻璃窗', kind: '修圖', learn: ['opacity'], palette: [C.red, C.blue, C.yellow], star3: 3,
    npc: '彩色玻璃要透光才漂亮。選取每一片圓形玻璃，把右邊的「不透明度」調成 60%，看看重疊的地方會變成什麼顏色。',
    hint: '三片玻璃都改成不透明度 60%。',
    phases: [{ name: '玻璃窗', target: GLASS_T, start: GLASS_S, rules: { require: { ellipse: 3 } } }] },
  { title: '滴管偵探', kind: '修圖', learn: ['dropper'], palette: [C.green, K2.grey], star3: 5,
    npc: '花的顏色在色票條上找不到！先用【選取】點一片花瓣，再換【滴管】（D）去點左上角的粉紅色樣本，花瓣就會變成一樣的顏色。',
    hint: '四片花瓣吸粉紅色樣本，花心吸黃色樣本。',
    phases: [{ name: '花', target: [R(20, 20, 60, 60, K2.pink), R(20, 100, 60, 60, K2.sun), Rn(292, 330, 16, 250, C.green), E(250, 100, 100, 150, K2.pink), E(250, 330, 100, 150, K2.pink), E(120, 250, 150, 100, K2.pink), E(330, 250, 150, 100, K2.pink), E(250, 250, 100, 100, K2.sun)],
      start: [R(20, 20, 60, 60, K2.pink), R(20, 100, 60, 60, K2.sun), Rn(292, 330, 16, 250, C.green), E(250, 100, 100, 150, K2.grey), E(250, 330, 100, 150, K2.grey), E(120, 250, 150, 100, K2.grey), E(330, 250, 150, 100, K2.grey), E(250, 250, 100, 100, K2.grey)], rules: { require: { ellipse: 5 } } }] },
  { title: '拒毒安全路線圖', kind: '修圖', learn: ['hex', 'dash'], palette: [K2.grey, INK], star3: 6, pass: 0.9,
    npc: '放學回家要走安全的路，避開可疑的地方。在【填色與框線】面板練習「框線設定」：① 選取路線，切到「框線顏色」輸入色碼 #2f9e6e 按 Enter（也可以直接點面板上「題目顏色」的色塊），再到「框線樣式」把寬度改成 10、樣式改成「虛線」。② 選取可疑地點的圓，框線色碼 #c0425e、寬度 6、樣式「點線」。',
    hint: '色票列沒有這兩個顏色：在「框線顏色」分頁輸入色碼後按 Enter，或點「題目顏色」的色塊。框線樣式在面板的第三個分頁。',
    phases: [{ name: '安全路線', target: [BG(K2.cream), W_(R(50, 450, 110, 90, C.yellow), { lock: true }), W_(R(440, 60, 110, 90, C.blue), { lock: true }),
      W_(PATH([PN(105, 450), PN(210, 370), PN(330, 400), PN(400, 250), PN(495, 150)], false, 'none', '#2f9e6e', 10), { dash: 1 }), W_(E(140, 120, 180, 180, '#f6d9df'), { stroke: '#c0425e', sw: 6, dash: 2 })],
      start: [BG(K2.cream), W_(R(50, 450, 110, 90, C.yellow), { lock: true }), W_(R(440, 60, 110, 90, C.blue), { lock: true }),
      PATH([PN(105, 450), PN(210, 370), PN(330, 400), PN(400, 250), PN(495, 150)], false, 'none', INK, 4), E(140, 120, 180, 180, '#f6d9df')],
      rules: { require: { path: 1, ellipse: 1 }, has: [{ t: 'path', dash: 1, stroke: '#2f9e6e', sw: 10, msg: '路線要用色碼 #2f9e6e、寬度 10 的「虛線」。' }, { t: 'ellipse', dash: 2, stroke: '#c0425e', sw: 6, msg: '可疑地點的圓要用色碼 #c0425e、寬度 6 的「點線」。' }] } }] },
  { title: '港口的夕陽', kind: '修圖', learn: ['gradient'], palette: [K2.violet, K2.peach, K2.sun, K2.sea], star3: 2,
    npc: '夕陽的天空會從紫色慢慢變成橘色。選取天空，在填色面板按「線性漸層」，再點第 2 個色標，換成橘色。也可以用【漸層】工具（G）在天空上拖曳，決定漸層方向。',
    hint: '線性漸層預設是由上往下：色標 1 紫色、色標 2 橘色（#ffb35c）。',
    phases: [{ name: '夕陽', target: SUNSET_T, start: SUNSET_S, rules: { require: { rect: 2 } } }] },
  { title: '會發亮的球', kind: '修圖', learn: ['radial'], palette: [C.blue, C.white], star3: 1,
    npc: '讓藍色的球發亮！選取球，在填色面板按「放射漸層」，中心會自動變成白色的亮點。',
    hint: '放射漸層：色標 1 白色在中心，色標 2 藍色在外圈。',
    phases: [{ name: '彩球', target: [Rn(0, 420, 600, 180, '#e9dcc6'), W_(E(200, 410, 200, 40, '#c9bba3'), { stroke: 'none' }), W_(E(180, 160, 240, 240, C.blue), { fill: { g: 'rad', c: [C.white, C.blue], a: 0 } })],
      start: [Rn(0, 420, 600, 180, '#e9dcc6'), W_(E(200, 410, 200, 40, '#c9bba3'), { stroke: 'none' }), E(180, 160, 240, 240, C.blue)], rules: { require: { ellipse: 2 } } }] },
  { title: '港口的燈塔', kind: '臨摹', learn: [], palette: [C.white, C.red, K2.sun, K2.navy, K2.violet], star3: 9,
    npc: '畫一座夜晚的燈塔：天空用漸層、塔身和屋頂用多邊形、燈室是紅色矩形，最後畫一道沒有外框、半透明的黃色光束。',
    hint: '天空：線性漸層深藍到紫色。光束：框線設為無、不透明度 50%。',
    phases: [{ name: '燈塔', target: [W_(Rn(0, 0, 600, 420, K2.navy), { fill: { g: 'lin', c: [K2.navy, K2.violet], a: 90 } }), Rn(0, 420, 600, 180, K2.sea), P([[250, 460], [350, 460], [330, 200], [270, 200]], C.white), R(260, 160, 80, 40, C.red), P([[250, 160], [300, 110], [350, 160]], C.red), W_(P([[340, 170], [600, 100], [600, 240]], K2.sun), { stroke: 'none', op: 0.5 })],
      start: [Rn(0, 0, 600, 420, K2.navy), Rn(0, 420, 600, 180, K2.sea)], rules: { require: { poly: 3, rect: 3 } } }] },
  { title: '灰霾・色彩對決', kind: '世界王', boss: true, learn: [], palette: [C.red, C.orange, C.green, C.blue, C.yellow, K2.violet, K2.peach, K2.sun, K2.sea, K2.grey], star3: 10, pass: 0.88,
    npc: '灰霾的毒霧把顏色都弄淡了！連續修好三幅畫：水果盤、三色玻璃窗、港口的夕陽。',
    hint: '三幅都是這個世界修過的畫，照之前的方法做就可以。',
    phases: [
      { name: '水果盤', target: FRUIT_T, start: FRUIT_S, rules: { require: { ellipse: 4 } }, say: '「顏色？我全部吃掉了！」' },
      { name: '三色玻璃窗', target: GLASS_T, start: GLASS_S, rules: { require: { ellipse: 3 } }, say: '「還撐得住嗎……」' },
      { name: '港口的夕陽', target: SUNSET_T, start: SUNSET_S, rules: { require: { rect: 2 } }, say: '「不……我的毒霧……！」' }] }
]);

/* ---------- 第三世界：構圖畫廊 ---------- */
var PAINT_R = R(180, 180, 240, 180, C.blue);
var WING = P([[290, 210], [150, 110], [100, 250], [170, 300], [120, 420], [290, 380]], C.purple);
var BODY = E(285, 170, 30, 260, INK);
var BFLY_S = [WING, BODY], BFLY_T = [WING, BODY, FLIP(WING, 'h', 300)];
var BLADE = P([[300, 300], [265, 120], [335, 120]], C.red), HUB = E(285, 285, 30, 30, K2.gold), POLE = R(290, 300, 20, 280, C.brown);
var MILL_S = [POLE, BLADE, HUB], MILL_T = [POLE, BLADE, HUB, ROT(BLADE, 90, 300, 300), ROT(BLADE, 180, 300, 300), ROT(BLADE, 270, 300, 300)];
var BOOK_C = [C.red, C.blue, C.green, C.orange, C.purple], BOOK_H = [180, 140, 200, 160, 120], BOOK_OFF = [-20, -50, 0, -30, -10];
var SHELF_T = [BG(K2.wall), R(60, 400, 480, 20, C.brown)].concat(BOOK_H.map(function (h, i) { return R(100 + 70 * i, 400 - h, 50, h, BOOK_C[i]); })).concat([R(200, 60, 200, 60, K2.gold)]);
var SHELF_S = SHELF_T.map(function (o, i) { var c = cloneObj(o); if (i >= 2 && i <= 6) c.y += BOOK_OFF[i - 2]; if (i === 7) c.x = 60; return c; });
var ARM = W_(P([[294, 300], [294, 170], [270, 140], [280, 132], [300, 158], [320, 132], [330, 140], [306, 170], [306, 300]], K2.ice), { stroke: 'none' });
addWorld(3, [
  { title: '歪掉的名畫', kind: '修圖', learn: ['rotate'], palette: [C.blue, K2.gold], star3: 2,
    npc: '名畫被撞歪了 15°！選取它，在上方工具控制列的「旋轉」輸入 -15 按套用。右上角的金色門牌則要轉 45° 變成菱形。',
    hint: '畫：旋轉 -15°。門牌：旋轉 45°。也可以拖曳選取框上方的圓形把手旋轉。',
    phases: [{ name: '名畫', target: [BG(K2.wall), PAINT_R, ROT(R(460, 60, 80, 80, K2.gold), 45, 500, 100)], start: [BG(K2.wall), ROT(PAINT_R, 15, 300, 270), R(460, 60, 80, 80, K2.gold)], rules: {} }] },
  { title: '對稱的蝴蝶', kind: '效率', learn: ['flip', 'dup'], palette: [C.purple, INK], star3: 3,
    npc: '蝴蝶只有左邊翅膀。選取翅膀，按 Ctrl+D「複製」，再按 H「水平翻轉」，最後把它拖到身體右邊。',
    hint: '翻轉後的翅膀 X 要設成 310，正好和左邊對稱。',
    phases: [{ name: '蝴蝶', target: BFLY_T, start: BFLY_S, rules: { require: { poly: 2 } } }] },
  { title: '一排畫框', kind: '效率', learn: [], palette: [K2.gold], star3: 8,
    npc: '畫廊要掛 5 個一模一樣的畫框，間隔 30。複製第一個畫框，再拖到右邊，比重畫快得多！',
    hint: '畫框的 X 依序是 40、150、260、370、480。複製後直接在 X 欄輸入數字最準。',
    phases: [{ name: '畫框', target: [BG(K2.wall)].concat([0, 1, 2, 3, 4].map(function (i) { return R(40 + 110 * i, 220, 80, 110, K2.gold); })), start: [BG(K2.wall), R(40, 220, 80, 110, K2.gold)], rules: { require: { rect: 6 } } }] },
  { title: '整齊的書架', kind: '修圖', learn: ['multi', 'align'], palette: BOOK_C, star3: 2,
    npc: '書東倒西歪！用【選取】從空白處拖出一個框把 5 本書框起來（多選），在右邊【對齊與分佈】按「底端對齊」。上方的金色牌子則要對齊「畫布」的水平中央。',
    hint: '書：相對於「選取範圍」底端對齊。牌子：改成相對於「畫布」，按水平置中。',
    phases: [{ name: '書架', target: SHELF_T, start: SHELF_S, rules: { require: { rect: 8 } } }] },
  { title: '等距的柵欄', kind: '修圖', learn: ['distribute'], palette: [C.white, C.green], star3: 1,
    npc: '柵欄的間隔忽大忽小。把 6 根木條全部框選，在【對齊與分佈】按「水平等距分佈」。',
    hint: '第一根和最後一根位置不變，中間的會自動平均排好。',
    phases: [{ name: '柵欄', target: [Rn(0, 450, 600, 150, C.green)].concat([60, 150, 240, 330, 420, 510].map(function (x) { return R(x, 250, 40, 200, C.white); })), start: [Rn(0, 450, 600, 150, C.green)].concat([60, 110, 260, 290, 450, 510].map(function (x) { return R(x, 250, 40, 200, C.white); })), rules: { require: { rect: 7 } } }] },
  { title: '疊疊樂', kind: '修圖', learn: ['zorder'], palette: [K2.sun, C.orange, C.brown], star3: 2,
    npc: '前後順序亂了：太陽跑到山的前面，門被牆遮住了。用工具控制列的「降低一層」「升到最上」調整圖層。',
    hint: '選太陽按 PgDn（降低一層）；選門按 Home（升到最上）。',
    phases: [{ name: '風景', target: [BG(C.sky), E(380, 90, 140, 140, K2.sun), P([[150, 450], [420, 170], [600, 450]], C.purple), R(120, 330, 180, 170, C.orange), R(185, 400, 50, 100, C.brown)],
      start: [BG(C.sky), P([[150, 450], [420, 170], [600, 450]], C.purple), E(380, 90, 140, 140, K2.sun), R(185, 400, 50, 100, C.brown), R(120, 330, 180, 170, C.orange)], rules: { require: { rect: 3 } } }] },
  { title: '學院的風車', kind: '效率', learn: ['rcenter'], palette: [C.red, K2.gold, C.brown], star3: 5,
    npc: '風車要有 4 片扇葉。把旋轉中心改成「畫布中心」，複製扇葉後旋轉 90°。動動腦：一次選兩片再複製，可以更快！',
    hint: '複製扇葉→旋轉 90；再選這兩片→複製→旋轉 180。只要 4 步。',
    phases: [{ name: '風車', target: MILL_T, start: MILL_S, rules: { require: { poly: 4 } } }] },
  { title: '雪花結晶', kind: '效率', learn: [], palette: [K2.ice, K2.navy], star3: 7,
    npc: '雪花有 6 支一樣的枝條，每支相差 60°。用「複製＋旋轉」完成，想想怎麼用最少步驟？',
    hint: '旋轉中心選畫布中心。1 支→2 支（轉 60°）→4 支（兩支一起轉 120°）→6 支。',
    phases: [{ name: '雪花', target: [BG(K2.navy)].concat([0, 60, 120, 180, 240, 300].map(function (d) { return ROT(ARM, d, 300, 300); })), start: [BG(K2.navy), ARM], rules: { require: { poly: 6 } } }] },
  { title: '反毒海報佈展', kind: '臨摹', learn: [], palette: [K2.gold, K2.sun], star3: 6,
    npc: '佈展日！三幅畫要頂端對齊、間隔一樣；右邊的壁燈要和左邊對稱。',
    hint: '三幅畫：頂端對齊＋水平等距。壁燈：複製、水平翻轉，再移到 X=530。',
    phases: [{ name: '畫廊', target: [BG(K2.wall), R(60, 140, 120, 150, K2.gold), R(240, 140, 120, 150, K2.gold), R(420, 140, 120, 150, K2.gold), P([[30, 100], [50, 60], [70, 100]], K2.sun), P([[530, 100], [550, 60], [570, 100]], K2.sun)],
      start: [BG(K2.wall), R(60, 180, 120, 150, K2.gold), R(200, 140, 120, 150, K2.gold), R(420, 200, 120, 150, K2.gold), P([[30, 100], [50, 60], [70, 100]], K2.sun)], rules: { require: { rect: 4, poly: 2 } } }] },
  { title: '灰霾・構圖對決', kind: '世界王', boss: true, learn: [], palette: [C.purple, C.red, K2.gold, C.brown, INK].concat(BOOK_C), star3: 11, pass: 0.88,
    npc: '灰霾的毒霧讓畫廊一團亂！連續完成：對稱的蝴蝶、學院的風車、整齊的書架。',
    hint: '蝴蝶用翻轉、風車用旋轉、書架用對齊。',
    phases: [
      { name: '蝴蝶', target: BFLY_T, start: BFLY_S, rules: { require: { poly: 2 } }, say: '「對稱？我最討厭對稱了！」' },
      { name: '風車', target: MILL_T, start: MILL_S, rules: { require: { poly: 4 } }, say: '「別轉了……我頭好暈……」' },
      { name: '書架', target: SHELF_T, start: SHELF_S, rules: { require: { rect: 8 } }, say: '「太整齊了……我受不了……！」' }] }
]);

/* ---------- 第四世界：曲線畫室 ---------- */
var DIAMOND_P = PATH([PN(300, 100), PN(420, 300), PN(300, 500), PN(180, 300)], true, C.green);
var LEAF_P = smoothNode(smoothNode(cloneObj(DIAMOND_P), 1), 3);
var DROP_P = PATH([PN(300, 110), PN(300, 490, [170, 0], [-170, 0], 2)], true, C.blue);
var HEART_P = PATH([PN(300, 230), PN(490, 230, [0, -130], [0, 130], 2), PN(300, 520), PN(110, 230, [0, 130], [0, -130], 2)], true, C.red);
addWorld(4, [
  { title: '彎彎的彩虹', kind: '修圖', learn: ['node'], palette: [C.red], star3: 1, pass: 0.78,
    npc: '歡迎來到曲線畫室！換成【節點】工具（N），點一下彩虹選取它，然後按住線條的中間往上拖，直線就會彎成拱形。',
    hint: '在線條正中間按住，往上拖到大約 Y=180 的地方。',
    phases: [{ name: '彩虹', target: [BG(C.sky), PATH([PN(100, 420, null, [0, -320]), PN(500, 420, [0, -320], null)], false, 'none', C.red, 24)], start: [BG(C.sky), PATH([PN(100, 420), PN(500, 420)], false, 'none', C.red, 24)], rules: { require: { path: 1 } } }] },
  { title: '圓滑的葉子', kind: '修圖', learn: ['nodeops'], palette: [C.green], star3: 2,
    npc: '用【節點】工具點選葉子，再點左邊或右邊的方形節點，按工具控制列的「平滑」，尖角就會變成圓弧。',
    hint: '左右兩個節點都要變平滑，上下兩個保持尖角。',
    phases: [{ name: '葉子', target: [LEAF_P], start: [DIAMOND_P], rules: { require: { path: 1 } } }] },
  { title: '一滴水', kind: '臨摹', learn: ['pen'], palette: [C.blue], star3: 1, pass: 0.8,
    npc: '【貝茲曲線】工具（B）登場！在上方「點一下」做尖角，到下方「按住往旁邊拖」拉出圓弧，最後點回第一個節點封閉。',
    hint: '下方的節點往左或往右拖大約 170。',
    phases: [{ name: '水滴', target: [DROP_P], start: null, rules: { require: { path: 1 } } }] },
  { title: '愛自己的心', kind: '臨摹', learn: [], palette: [C.red], star3: 1, pass: 0.85,
    npc: '愛自己，就不碰毒品！畫一顆愛心送給自己。愛心有 4 個節點：上凹點和下尖點「點一下」，左右兩個圓邊「按住上下拖」。',
    hint: '順序：上凹點 → 右邊往下拖 → 下尖點 → 左邊往上拖 → 點回起點。',
    phases: [{ name: '愛心', target: [HEART_P], start: null, rules: { require: { path: 1 } } }] },
  { title: '海上的波浪', kind: '臨摹', learn: [], palette: [K2.sea], star3: 1, pass: 0.6,
    npc: '畫一條不封閉的波浪線：兩端點一下，中間三個轉彎處按住「往右」拖，最後按 Enter 完成，不要點回起點。',
    hint: '波峰在 Y=240、波谷在 Y=340。不封閉的路徑會用目前顏色當線條顏色。',
    phases: [{ name: '波浪', target: [W_(Rn(0, 330, 600, 270, C.sky), { lock: true }), PATH([PN(60, 300), PN(180, 240, [-50, 0], [50, 0], 2), PN(300, 340, [-50, 0], [50, 0], 2), PN(420, 240, [-50, 0], [50, 0], 2), PN(540, 300)], false, 'none', K2.sea, 12)], start: [W_(Rn(0, 330, 600, 270, C.sky), { lock: true })], rules: { require: { path: 1 } } }] },
  { title: '彎彎的月亮', kind: '臨摹', learn: [], palette: [K2.sun], star3: 1, pass: 0.85,
    npc: '月牙有兩個尖角和兩段弧：外弧比較胖、內弧比較瘦。',
    hint: '上尖角 → 左外弧往下拖 → 下尖角 → 內弧往上拖 → 點回起點。',
    phases: [{ name: '月亮', target: [BG(K2.navy), PATH([PN(330, 110), PN(170, 300, [0, -120], [0, 120], 2), PN(330, 490), PN(270, 300, [0, 110], [0, -110], 2)], true, K2.sun)], start: [BG(K2.navy)], rules: { require: { path: 1 } } }] },
  { title: '補一個山頭', kind: '修圖', learn: ['insert'], palette: [C.purple], star3: 6,
    npc: '這座山只有一個山峰。用【節點】工具在線段上「雙擊」可以插入新節點，或選一個節點按「插入節點」，再把節點拖到正確位置，做出兩座山峰。',
    hint: '目標節點：(60,480)、(200,220)、(300,320)、(400,180)、(540,480)。',
    phases: [{ name: '雙峰', target: [PATH([PN(60, 480), PN(200, 220), PN(300, 320), PN(400, 180), PN(540, 480)], true, C.purple)], start: [PATH([PN(60, 480), PN(300, 160), PN(540, 480)], true, C.purple)], rules: { require: { path: 1 } } }] },
  { title: '太多節點了', kind: '修圖', learn: ['delnode'], palette: [K2.cream], star3: 4,
    npc: '蛋被戳出四個尖刺！用【節點】工具選取尖刺上的節點，按 Delete 刪掉，讓蛋恢復圓滑。',
    hint: '只刪四個方形的尖刺節點，圓形的平滑節點要留下。',
    phases: [{ name: '蛋', target: [PATH([PN(300, 120, [-90, 0], [90, 0], 1), PN(430, 330, [0, -110], [0, 100], 1), PN(300, 480, [80, 0], [-80, 0], 1), PN(170, 330, [0, 100], [0, -110], 1)], true, K2.cream)],
      start: [PATH([PN(300, 120, [-90, 0], [90, 0], 1), PN(440, 150), PN(430, 330, [0, -110], [0, 100], 1), PN(450, 470), PN(300, 480, [80, 0], [-80, 0], 1), PN(150, 470), PN(170, 330, [0, 100], [0, -110], 1), PN(160, 150)], true, K2.cream)], rules: { require: { path: 1 } } }] },
  { title: '池塘的小魚', kind: '臨摹', learn: [], palette: [C.orange, INK, C.sky], star3: 4, pass: 0.88,
    npc: '畫一條小魚：身體用貝茲曲線（嘴和尾巴接點是尖角、上下是圓弧），尾巴用多邊形，最後加上眼睛。',
    hint: '身體：(140,300) → (300,200) 往右拖 80 → (430,300) → (300,400) 往左拖 80 → 點回起點。',
    phases: [{ name: '小魚', target: [BG(C.sky), PATH([PN(140, 300), PN(300, 200, [-80, 0], [80, 0], 2), PN(430, 300), PN(300, 400, [80, 0], [-80, 0], 2)], true, C.orange), P([[420, 300], [520, 230], [520, 370]], C.orange), E(180, 270, 20, 20, INK)], start: [BG(C.sky)], rules: { require: { path: 1, poly: 1, ellipse: 1 } } }] },
  { title: '灰霾・曲線對決', kind: '世界王', boss: true, learn: [], palette: [C.green, C.blue, C.red], star3: 6, pass: 0.82,
    npc: '灰霾用毒霧把曲線都弄僵了！連續完成：圓滑的葉子、一滴水、畫家的愛心。',
    hint: '葉子用節點工具平滑；水滴和愛心用貝茲曲線工具。',
    phases: [
      { name: '葉子', target: [LEAF_P], start: [DIAMOND_P], rules: { require: { path: 1 } }, say: '「彎彎曲曲的，真難看！」' },
      { name: '水滴', target: [DROP_P], start: null, rules: { require: { path: 1 } }, say: '「還撐得住嗎……」' },
      { name: '愛心', target: [HEART_P], start: null, rules: { require: { path: 1 } }, say: '「不……我的毒霧……！」' }] }
]);

/* ---------- 第五世界：節點工坊 ---------- */
var MEDAL_S = [BG('#3a2a5a'), P([[220, 380], [260, 380], [240, 560], [200, 520]], C.red), P([[340, 380], [380, 380], [400, 520], [360, 560]], C.red)];
var MEDAL_T = MEDAL_S.concat([STAR(300, 300, 180, 5, 0.5, true, K2.gold)]);
var EGG_S = [E(200, 180, 200, 260, K2.cream)];
var EGG_T = (function () { var p = toPath(EGG_S[0]); p.nodes[0].y -= 60; return [p]; })();
var SFISH_T = (function () { var p = toPath(STAR(300, 310, 180, 5, 0.45, true, C.orange)); [1, 3, 5, 7, 9].forEach(function (k) { smoothNode(p, k); }); return [BG('#bfe3f3'), p]; })();
addWorld(5, [
  { title: '拒毒勇士勳章', kind: '臨摹', learn: ['star'], palette: [K2.gold, C.red], star3: 1,
    npc: '勇敢說「不」的人，值得一枚勳章！節點工坊的第一課：【星形與多邊形】工具（*）。從星星中心按住，往正上方拖，就會畫出一顆五角星。',
    hint: '從 (300,300) 拖到 (300,120)。工具控制列可以改角數和內徑比。',
    phases: [{ name: '勳章', target: MEDAL_T, start: MEDAL_S, rules: { require: { poly: 3 } } }] },
  { title: '警告與停止標誌', kind: '臨摹', learn: [], palette: [C.red, C.blue, C.green], star3: 3,
    npc: '交通標誌裡，三角形代表「警告」、八角形代表「停止」，看到可疑的東西也要停下來！把星形工具切換成「多邊形」，畫出三角形、六邊形和八邊形，角數在工具控制列設定。',
    hint: '三個圖形的中心都在 Y=300，X 分別是 150、300、450，半徑 90，都往正上方拖。',
    phases: [{ name: '看板', target: [STAR(150, 300, 90, 3, 0.5, false, C.red), STAR(300, 300, 90, 6, 0.5, false, C.blue), STAR(450, 300, 90, 8, 0.5, false, C.green)], start: null, rules: { require: { poly: 3 } } }] },
  { title: '學院的檯燈', kind: '修圖', learn: ['topath'], palette: [K2.sun, C.brown], star3: 3,
    npc: '矩形不能用節點工具改形狀。先選取燈罩，按「物件轉路徑」（Shift+Ctrl+C），再用【節點】工具把上面兩個角往內拖，變成梯形燈罩。',
    hint: '左上角拖到 (240,150)，右上角拖到 (360,150)。',
    phases: [{ name: '檯燈', target: [R(280, 290, 40, 180, C.brown), R(220, 470, 160, 20, C.brown), PATH([PN(240, 150), PN(360, 150), PN(400, 290), PN(200, 290)], true, K2.sun)], start: [R(280, 290, 40, 180, C.brown), R(220, 470, 160, 20, C.brown), R(200, 150, 200, 140, K2.sun)], rules: { require: { path: 1 } } }] },
  { title: '圓變蛋', kind: '修圖', learn: [], palette: [K2.cream], star3: 2,
    npc: '把橢圓「物件轉路徑」，再把最上面的節點往上拖 60，圓就變成蛋了。',
    hint: '最上面的節點從 (300,180) 拖到 (300,120)。',
    phases: [{ name: '蛋', target: EGG_T, start: EGG_S, rules: { require: { path: 1 } } }] },
  { title: '貓咪的眼睛', kind: '修圖', learn: [], palette: ['#9be36b', INK], star3: 2,
    npc: '貓眼是兩頭尖的。用【節點】工具選取眼睛最左和最右的節點，按「尖角」收回把手。',
    hint: '左右兩個節點變尖角，上下兩個保持平滑。',
    phases: [{ name: '貓眼', target: (function () { var p = toPath(E(150, 200, 300, 200, '#9be36b')); [1, 3].forEach(function (k) { p.nodes[k].i = null; p.nodes[k].o = null; p.nodes[k].s = 0; }); return [BG('#3a2a5a'), p, E(280, 220, 40, 160, INK)]; })(),
      start: [BG('#3a2a5a'), toPath(E(150, 200, 300, 200, '#9be36b')), E(280, 220, 40, 160, INK)], rules: { require: { path: 1 } } }] },
  { title: '對稱的花瓶', kind: '修圖', learn: ['sym'], palette: [C.blue], star3: 2,
    npc: '花瓶兩邊的弧度不平均。選取左右兩側最胖的節點，按「對稱」，讓兩根把手一樣長。',
    hint: '只要改左右兩個圓形節點。',
    phases: [{ name: '花瓶', target: [PATH([PN(240, 120), PN(360, 120), PN(420, 330, [0, -100], [0, 100], 2), PN(360, 480), PN(240, 480), PN(180, 330, [0, 100], [0, -100], 2)], true, C.blue)],
      start: [PATH([PN(240, 120), PN(360, 120), PN(420, 330, [0, -60], [0, 140], 1), PN(360, 480), PN(240, 480), PN(180, 330, [0, 140], [0, -60], 1)], true, C.blue)], rules: { require: { path: 1 } } }] },
  { title: '圓滑的海星', kind: '臨摹', learn: [], palette: [C.orange], star3: 7,
    npc: '先用星形工具畫出五角星（內徑比 0.45），轉成路徑後，把 5 個凹進去的節點都變「平滑」。',
    hint: '星星中心 (300,310)，往上拖 180。凹進去的節點是第 2、4、6、8、10 個。',
    phases: [{ name: '海星', target: SFISH_T, start: [BG('#bfe3f3')], rules: { require: { path: 1 } } }] },
  { title: '學院的齒輪', kind: '臨摹', learn: [], palette: [K2.grey, C.white], star3: 2,
    npc: '齒輪是一顆有 12 個角、內徑比 0.8 的星形，中間再加一個白色圓孔。',
    hint: '星形：角數 12、內徑比 0.8，中心 (300,300) 往上拖 170。圓孔：(240,240) 到 (360,360)。',
    phases: [{ name: '齒輪', target: [STAR(300, 300, 170, 12, 0.8, true, K2.grey), E(240, 240, 120, 120, C.white)], start: null, rules: { require: { poly: 1, ellipse: 1 } } }] },
  { title: '熱氣球', kind: '臨摹', learn: [], palette: [C.red, C.brown, INK], star3: 6,
    npc: '橢圓轉成路徑後，把最下面的節點往下拉，就變成熱氣球。再畫吊籃和兩條繩子。',
    hint: '氣球底部節點拖到 (300,390)。繩子從 (280,390) 和 (320,390) 往下連到吊籃。',
    phases: [{ name: '熱氣球', target: (function () { var p = toPath(E(180, 80, 240, 260, C.red)); p.nodes[2].y = 390; return [BG(C.sky), p, Ln(280, 390, 280, 440, INK, 8), Ln(320, 390, 320, 440, INK, 8), R(270, 440, 60, 50, C.brown)]; })(),
      start: [BG(C.sky), E(180, 80, 240, 260, C.red)], rules: { require: { path: 1, line: 2, rect: 2 } } }] },
  { title: '灰霾・節點對決', kind: '世界王', boss: true, learn: [], palette: [K2.gold, C.red, K2.cream, C.orange], star3: 12, pass: 0.88,
    npc: '灰霾的節點陷阱！連續完成：星形勳章、圓變蛋、圓滑的海星。',
    hint: '勳章用星形工具；蛋要先轉路徑；海星轉路徑後把凹點變平滑。',
    phases: [
      { name: '勳章', target: MEDAL_T, start: MEDAL_S, rules: { require: { poly: 3 } }, say: '「星星？讓我把它塗黑！」' },
      { name: '蛋', target: EGG_T, start: EGG_S, rules: { require: { path: 1 } }, say: '「還撐得住嗎……」' },
      { name: '海星', target: SFISH_T, start: [BG('#bfe3f3')], rules: { require: { path: 1 } }, say: '「不……我的毒霧……！」' }] }
]);

/* ---------- 第六世界：宮廷畫院 ---------- */
var CLOUDS = [E(130, 200, 160, 160, C.white), E(220, 150, 180, 180, C.white), E(330, 190, 150, 150, C.white), E(180, 260, 260, 120, C.white)];
var CLOUD_S = [BG(C.sky)].concat(CLOUDS), CLOUD_T = [BG(C.sky), BOOL('union', CLOUDS)];
var DONUT = [E(150, 150, 300, 300, '#d63a4e'), E(210, 210, 180, 180, C.white)];
var DONUT_S = [BG('#f3ecdf')].concat(DONUT), DONUT_T = [BG('#f3ecdf'), BOOL('diff', DONUT)];
var SIGN_S = [BG(K2.wall), R(100, 200, 400, 160, C.brown)], SIGN_T = SIGN_S.concat([TXT(180, 300, '拒絕毒品', 60, K2.gold)]);
var LENS = [E(200, 150, 200, 200, C.green), E(300, 150, 200, 200, C.green)];
var BADGE = [E(150, 100, 300, 300, K2.navy), STAR(300, 250, 110, 5, 0.5, true, K2.gold), P([[130, 380], [470, 380], [440, 460], [160, 460]], C.red), TXT(220, 440, '拒毒小隊', 40, C.white)];
addWorld(6, [
  { title: '搬家的小屋', kind: '效率', learn: ['group'], palette: [C.orange, C.red, C.brown], star3: 2,
    npc: '小屋要搬到右邊。把牆、屋頂、門框選起來，按 Ctrl+G「群組」，它們就變成一個物件，可以一起搬。',
    hint: '群組後往右拖 220。',
    phases: [{ name: '小屋', target: [Rn(0, 480, 600, 120, C.green), { t: 'group', items: HOUSE.map(function (o) { return MOVE(o, 100, 0); }) }], start: [Rn(0, 480, 600, 120, C.green)].concat(HOUSE.map(function (o) { return MOVE(o, -120, 0); })), rules: { require: { group: 1 } } }] },
  { title: '雲朵合體', kind: '修圖', learn: ['union'], palette: [C.white], star3: 1,
    npc: '四個圓疊在一起，裡面還看得到線。全部選取後按「相加」（Inkscape 的 路徑 → 聯集，Ctrl++），它們會合成一朵只有外框的雲。',
    hint: '框選四個圓（不要選到天空），再按相加。',
    phases: [{ name: '雲朵', target: CLOUD_T, start: CLOUD_S, rules: { require: { compound: 1 } } }] },
  { title: '禁止標誌的圓環', kind: '修圖', learn: ['diff'], palette: [C.white], star3: 1,
    npc: '「禁止標誌」是一個紅色圓環。「相減」（Inkscape 的 路徑 → 差集，Ctrl+-）會用上面的圖形在下面的圖形挖洞：選取大圓和小圓，按相減做出圓環。',
    hint: '小圓在上面，所以會從大圓裡挖掉。',
    phases: [{ name: '圓環', target: DONUT_T, start: DONUT_S, rules: { require: { compound: 1 } } }] },
  { title: '宮殿的鑰匙孔', kind: '修圖', learn: [], palette: [K2.gold], star3: 2,
    npc: '在金色門牌上挖出鑰匙孔：選取門牌、圓形和梯形，按相減。',
    hint: '三個一起選，按一次相減就可以；也可以先把圓和梯形相加。',
    phases: [{ name: '鑰匙孔', target: [BG(K2.wall), BOOL('diff', [R(200, 120, 200, 300, K2.gold), E(270, 180, 60, 60, INK), P([[285, 220], [315, 220], [330, 330], [270, 330]], INK)])], start: [BG(K2.wall), R(200, 120, 200, 300, K2.gold), E(270, 180, 60, 60, INK), P([[285, 220], [315, 220], [330, 330], [270, 330]], INK)], rules: { require: { compound: 1 } } }] },
  { title: '四葉草', kind: '效率', learn: ['intersect'], palette: [C.green], star3: 3,
    npc: '「交集」（Inkscape 的 路徑 → 交集，Ctrl+*）只留下兩個圖形重疊的部分。選兩個圓按交集變成一片葉子，再複製一片、旋轉 90°，四葉草就完成了。',
    hint: '交集 → Ctrl+D → 旋轉 90°（以物件中心）。',
    phases: [{ name: '四葉草', target: [BG('#f3ecd9'), Ln(300, 330, 300, 560, C.green, 10), BOOL('intersect', LENS), BOOL('intersect', LENS, { rot: 90 })], start: [BG('#f3ecd9'), Ln(300, 330, 300, 560, C.green, 10)].concat(LENS), rules: { require: { compound: 2 } } }] },
  { title: '拒毒標語招牌', kind: '精準', learn: ['text'], palette: [K2.gold, C.white], star3: 2,
    npc: '幫學院做一塊拒毒招牌！【文字】工具（T）：先在工具控制列打好「拒絕毒品」、字級選 60，再到招牌上點一下。文字的左下角就是你點的位置。',
    hint: '在 (180,300) 點一下。顏色選金色。',
    phases: [{ name: '招牌', target: SIGN_T, start: SIGN_S, rules: { text: ['拒絕毒品'] } }] },
  { title: '拒毒守護盾牌', kind: '修圖', learn: [], palette: [C.blue, K2.navy, K2.gold, C.white], star3: 7, pass: 0.9,
    npc: '做一面守護大家的盾牌，一次練習四個 Inkscape 技巧：① 選取方塊和橢圓按「相加」，合成盾牌外形；② 再把盾牌和白色十字一起選取，按「相減」挖出十字；③ 填色改成「線性漸層」，第 2 個色標換成深藍色；④ 框線換成金色，寬度 8。',
    hint: '相加 Ctrl++、相減 Ctrl+-。框線顏色可以按住 Shift 點色票。',
    phases: [{ name: '盾牌', target: [BG(K2.wall), BOOL('diff', [BOOL('union', [W_(R(190, 100, 220, 190, C.blue), { fill: { g: 'lin', c: [C.blue, K2.navy], a: 90 }, stroke: K2.gold, sw: 8 }), E(190, 160, 220, 300, C.blue)]), R(275, 175, 50, 170, C.white), R(215, 230, 170, 50, C.white)])],
      start: [BG(K2.wall), R(190, 100, 220, 190, C.blue), E(190, 160, 220, 300, C.blue), R(275, 175, 50, 170, C.white), R(215, 230, 170, 50, C.white)],
      rules: { require: { compound: 1 }, has: [{ t: 'compound', grad: 'lin', msg: '盾牌要用「線性漸層」填色。' }, { t: 'compound', stroke: K2.gold, sw: 8, msg: '盾牌要加上金色、寬度 8 的框線。' }] } }] },
  { title: '拒毒小隊徽章', kind: '臨摹', learn: [], palette: [K2.navy, K2.gold, C.red, C.white], star3: 5,
    npc: '設計拒毒小隊的徽章：深藍圓形底、金色五角星、紅色緞帶，緞帶上寫「拒毒小隊」。',
    hint: '星：中心 (300,250) 往上拖 110。文字：字級 40、白色，在 (220,440) 點一下。',
    phases: [{ name: '徽章', target: BADGE, start: null, rules: { require: { ellipse: 1, poly: 2 }, text: ['拒毒小隊'] } }] },
  { title: '我的反毒海報', kind: '創作', creative: true, learn: [], palette: [C.red, C.orange, C.yellow, C.green, C.blue, C.purple, K2.gold, K2.navy, C.white, INK], star3: 40, pass: 0,
    npc: '反毒海報展開幕！用學過的所有工具設計一張反毒海報：至少 3 種圖形、2 種顏色，要有一句含「毒」或「拒」字的反毒標語，並把部分圖形組成群組。',
    hint: '標語可以是「拒絕毒品」「我拒毒，也幫別人拒毒」。完成後可以拿去參加學校的反毒海報活動！',
    phases: [{ name: '自由創作', target: [R(100, 60, 400, 440, K2.cream), { t: 'group', items: BADGE }], start: null, rules: { creative: { types: 3, colors: 2, text: true, textHas: ['毒', '拒'], group: true } } }] },
  { title: '無毒王國大決戰', kind: '世界王', boss: true, learn: [], palette: [C.white, K2.gold, C.brown], star3: 6, pass: 0.88,
    npc: '最終決戰！灰霾想讓整座宮廷畫院被毒霧籠罩。連續完成：雲朵合體、禁止標誌的圓環、拒毒標語招牌，讓世界恢復無毒的色彩！',
    hint: '雲朵用相加、圓環用相減、招牌用文字工具。',
    phases: [
      { name: '雲朵', target: CLOUD_T, start: CLOUD_S, rules: { require: { compound: 1 } }, say: '「來嘛，試一口就好……」' },
      { name: '圓環', target: DONUT_T, start: DONUT_S, rules: { require: { compound: 1 } }, say: '「為什麼……你都不上當……」' },
      { name: '招牌', target: SIGN_T, start: SIGN_S, rules: { text: ['拒絕毒品'] }, say: '「不……我的毒霧……！」' }] }
]);

LEVELS.forEach(function (l, i) { l.order = i + 1; });

/* ---------------- 拒毒內容：誘惑事件、識破挑戰、魔王前問答 ----------------
 * 每個世界：第 3、5、7、9 關前有「誘惑事件」，第 6 關前有「識破挑戰」，第 10 關前有 3 題「淨化問答」。
 * 答對得到拒毒徽章；第一次就答對再加金幣。選錯不扣分，院長會說明原因。
 * 用語參考教育部、法務部的學生藥物濫用防制宣導：不明物品不碰、識破偽裝、拒絕技巧、求助專線 0800-770-885。
 */
var ANTI_WORLDS = ['認識毒品', '識破偽裝', '拒絕技巧', '勇氣與紓壓', '求助與救援', '承諾與行動'];
var NPC_LOOKS = {
  stranger: { name: '陌生大哥哥', look: { skin: '#e8b48a', hairStyle: 'spiky', hair: '#1f1a24', hat: 'hat-none', outfit: 'smock#2a2233', face: 'face-sun', acc: 'acc-none', brush: 'brush-none', eyes: 'dot', pet: 'pet-none' } },
  friend: { name: '同學', look: { skin: '#fde3c8', hairStyle: 'twin', hair: '#5a3b2a', hat: 'hat-none', outfit: 'smock#f2c14e', face: 'face-none', acc: 'acc-none', brush: 'brush-none', eyes: 'big', pet: 'pet-none' } },
  boyfriend: { name: '好朋友小凱', look: { skin: '#f6d3ae', hairStyle: 'short', hair: '#8a5a35', hat: 'beret#2f9e6e', outfit: 'out-hoodie', face: 'face-none', acc: 'acc-none', brush: 'brush-none', eyes: 'dot', pet: 'pet-none' } },
  senior: { name: '學長', look: { skin: '#e8b48a', hairStyle: 'spiky', hair: '#9a4a2a', hat: 'hat-none', outfit: 'out-hoodie', face: 'face-none', acc: 'acc-none', brush: 'brush-none', eyes: 'sleepy', pet: 'pet-none' } },
  seniorgirl: { name: '學姊', look: { skin: '#fde3c8', hairStyle: 'long', hair: '#c58a3a', hat: 'hat-none', outfit: 'smock#f08cb0', face: 'face-none', acc: 'acc-none', brush: 'brush-none', eyes: 'wink', pet: 'pet-none' } },
  cousin: { name: '表哥', look: { skin: '#c98d5f', hairStyle: 'curly', hair: '#1f1a24', hat: 'hat-none', outfit: 'out-overall', face: 'face-none', acc: 'acc-none', brush: 'brush-none', eyes: 'dot', pet: 'pet-none' } },
  netfriend: { name: '網友', look: { skin: '#cfc3d9', hairStyle: 'bob', hair: '#5a7fd0', hat: 'hat-none', outfit: 'smock#7b4fc9', face: 'face-mask', acc: 'acc-none', brush: 'brush-none', eyes: 'dot', pet: 'pet-none' } },
  brother: { name: '哥哥', look: { skin: '#f6d3ae', hairStyle: 'short', hair: '#1f1a24', hat: 'hat-none', outfit: 'smock#3a2a5a', face: 'face-none', acc: 'acc-none', brush: 'brush-none', eyes: 'sleepy', pet: 'pet-none' } },
  sister: { name: '鄰居姊姊', look: { skin: '#fde3c8', hairStyle: 'pony', hair: '#5a3b2a', hat: 'hat-none', outfit: 'smock#5aa7e0', face: 'face-none', acc: 'acc-none', brush: 'brush-none', eyes: 'sleepy', pet: 'pet-none' } },
  kid: { name: '小表弟', look: { skin: '#f6d3ae', hairStyle: 'bun', hair: '#5a3b2a', hat: 'hat-cat', outfit: 'smock#58a84a', face: 'face-none', acc: 'acc-none', brush: 'brush-none', eyes: 'big', pet: 'pet-none' } }
};
// 誘惑事件：[選項, 對不對, 技巧名稱, 院長的說明]
var ANTI_TEMPT = {
  'W1-03': { who: 'stranger', item: 'candy', place: '公園', text: '一位不認識的大哥哥拿出一包沒有任何字的彩色糖果：「免費請你吃，很好吃喔！」', opts: [
    ['「不用了，謝謝！」說完就走回爸媽身邊。', true, '直接拒絕＋離開現場', '不認識的人給的東西不要拿，說完馬上回到大人身邊最安全。'],
    ['先收下放口袋，回家再吃。', false, '', '來源不明的東西，帶回家一樣危險，一開始就不要收。'],
    ['只吃一顆應該沒關係。', false, '', '新興毒品常偽裝成糖果，一顆就可能傷害身體。'],
    ['問他還有沒有別的口味。', false, '', '繼續和陌生人聊天，對方可能會更積極地引誘你。']] },
  'W1-05': { who: 'friend', item: 'drink', place: '教室', text: '下課時，同學拿出一瓶標籤被撕掉的飲料：「這是提神飲料，喝了上課都不會想睡！」', opts: [
    ['喝一小口試試看。', false, '', '不知道裡面加了什麼，一小口也可能有危險。'],
    ['「我不喝來路不明的飲料，我們去喝開水吧！」', true, '說明理由＋轉移話題', '說出理由再找別的事做，既拒絕了，也不會讓氣氛尷尬。'],
    ['幫他把飲料藏進我的書包。', false, '', '幫忙藏可疑的東西，會讓自己也陷入危險，應該告訴老師。'],
    ['用我的點心跟他交換。', false, '', '交換就等於收下了來路不明的飲料。']] },
  'W1-07': { who: 'netfriend', item: 'phone', place: '網路遊戲', text: '你在遊戲裡認識的網友私訊你：「我寄『快樂軟糖』給你，只要告訴我你家地址。」', opts: [
    ['給他地址，反正是免費的。', false, '', '不能把地址給網路上不認識的人，「免費」常常是陷阱。'],
    ['問他一包多少錢。', false, '', '繼續聊下去，只會讓對方更容易說服你。'],
    ['不回覆，把訊息截圖給爸媽或老師看。', true, '找大人幫忙', '網路上的誘惑要交給大人處理，截圖可以幫大人了解狀況。'],
    ['把訊息轉給同學，大家一起拿。', false, '', '轉傳會讓更多同學陷入危險。']] },
  'W1-09': { who: 'kid', item: 'powder', place: '放學路上', text: '你在地上看到一個小夾鏈袋，裡面裝著白色粉末。旁邊的小表弟想撿起來玩。', opts: [
    ['打開聞聞看是什麼味道。', false, '', '不明的粉末不能聞，有些毒品吸入就會造成傷害。'],
    ['帶到學校給同學看。', false, '', '帶著不明物品很危險，也可能讓別人誤碰。'],
    ['用手指沾一點嚐嚐。', false, '', '絕對不能吃不明的東西。'],
    ['拉住表弟不碰它，並告訴老師或警察。', true, '不碰不吃不聞＋找大人', '不明物品「不碰、不吃、不聞」，交給大人或警察處理。']] },
  'W2-03': { who: 'senior', item: 'coffee', place: '補習班', text: '學長給你一個印著卡通圖案的小咖啡包：「加水就能喝，喝了超有精神！」', opts: [
    ['包裝這麼可愛，應該只是普通咖啡。', false, '', '毒品咖啡包常用可愛、流行的包裝騙人，越可愛越要小心。'],
    ['「來路不明的咖啡包可能摻了毒品，我不要。」然後告訴老師。', true, '識破偽裝＋說明理由', '你識破了偽裝！沒有標示、別人送的咖啡包都不能喝。'],
    ['收下來送給爸爸喝。', false, '', '可疑的東西也不能拿給家人，會讓家人陷入危險。'],
    ['先喝一半就好。', false, '', '喝一半一樣會把毒品吃進身體。']] },
  'W2-05': { who: 'cousin', item: 'jelly', place: '親戚聚會', text: '表哥在聚會拿出一盒果凍：「這是大人才能吃的特別果凍，要不要試試？」', opts: [
    ['果凍一定沒問題，吃吧。', false, '', '新興毒品會做成果凍、軟糖，外表看不出來。'],
    ['偷拿一個帶回家。', false, '', '可疑的東西不能帶走。'],
    ['等大家都吃了我再吃。', false, '', '別人吃了，不代表它是安全的。'],
    ['「謝謝，我不要。」然後去找爸媽說這件事。', true, '直接拒絕＋找大人', '在聚會中遇到可疑的東西，馬上告訴身邊的家人。']] },
  'W2-07': { who: 'netfriend', item: 'popcandy', place: '網路商店', text: '你在網路上看到廣告：「吃了會很嗨的跳跳糖，超便宜，只限今天！」', opts: [
    ['不買也不點連結，告訴家人這個網站很可疑。', true, '識破偽裝＋找大人', '「吃了會很嗨」就是危險訊號，正常的糖果不會這樣宣傳。'],
    ['買一包來試試。', false, '', '「吃了會很嗨」的東西很可能摻了毒品。'],
    ['把連結分享到班級群組。', false, '', '分享會讓更多同學看到危險的東西。'],
    ['用爸媽的帳號偷偷買。', false, '', '偷偷用家人的帳號買可疑的東西，非常危險。']] },
  'W2-09': { who: 'cousin', item: 'vape', place: '公園', text: '讀國中的表哥拿出一支彩色的筆狀電子煙：「水果口味的，聞起來很香，吸一口嘛！」', opts: [
    ['水果口味的應該沒有害。', false, '', '電子煙和菸彈常被加入毒品，香香的味道是用來吸引人的。'],
    ['只吸一口不會怎樣。', false, '', '一口就可能吸進毒品或有害物質。'],
    ['「電子煙在台灣是禁止的，也可能摻了毒品，我不要。」', true, '說明理由', '你清楚說出理由，對方也比較不會一直勸你。'],
    ['答應幫他保密，不告訴大人。', false, '', '危險的事不能保密，要讓大人知道才能保護表哥。']] },
  'W3-03': { who: 'boyfriend', item: 'popcandy', place: '下課', text: '好朋友小凱：「這個跳跳糖很好玩，吃了會很嗨，一起吃嘛！」', opts: [
    ['「嗯……好吧，就這一次。」', false, '', '「就這一次」最危險，第一次就可能上癮。'],
    ['看著他，堅定地說：「不要，我不碰這種東西。」', true, '直接拒絕法', '直接拒絕要看著對方、語氣堅定，讓他知道你是認真的。'],
    ['不說話，讓他把糖放進我手裡。', false, '', '沉默會讓對方以為你答應了，一定要清楚說「不」。'],
    ['「你先吃，我看看會怎樣。」', false, '', '看別人吃也不安全，應該勸他不要吃並告訴老師。']] },
  'W3-05': { who: 'friend', item: 'coffee', place: '社區', text: '同學在你家附近：「我拿到一包很特別的咖啡，我們去公園試喝！」', opts: [
    ['「好啊，我也想知道是什麼味道。」', false, '', '好奇心不能用來試毒品。'],
    ['偷偷跟去，看他們喝。', false, '', '待在危險的地方，自己也可能被要求一起喝。'],
    ['「我們去打球吧！我新買了一顆籃球。」', true, '轉移話題法', '用更好玩的活動轉移話題，也可以把朋友帶離危險。'],
    ['回家拿零用錢跟他買一包。', false, '', '買毒品是違法的，也會傷害自己。']] },
  'W3-07': { who: 'senior', item: 'vape', place: '網咖門口', text: '一群人圍在網咖門口抽彩色菸彈，有人朝你招手：「過來一起玩啊！」', opts: [
    ['過去看看他們在做什麼。', false, '', '靠近只會讓自己更難脫身。'],
    ['站在旁邊等朋友出來。', false, '', '留在危險的地方，被勸誘的機會更高。'],
    ['拍影片上傳到網路。', false, '', '這樣可能惹上麻煩，應該先保護自己，再告訴大人。'],
    ['不靠近，馬上轉身離開，回到家人身邊。', true, '離開現場法', '覺得不對勁就立刻離開，是最快也最安全的方法。']] },
  'W3-09': { who: 'seniorgirl', item: 'jelly', place: '校門口', text: '高年級學姊向你的好朋友小美推銷「減肥果凍」，小美有點心動。', opts: [
    ['拉著小美說：「那可能有毒品，我們一起走，去告訴老師。」', true, '反過來勸朋友＋找大人', '你不只保護自己，也幫朋友拒絕了誘惑。'],
    ['「你要吃就吃，不關我的事。」', false, '', '朋友有危險時，一句提醒就可能救了她。'],
    ['「幫我也買一個。」', false, '', '來路不明的「減肥果凍」可能摻有毒品。'],
    ['「放心，我幫你保密。」', false, '', '危險的事不能保密，要讓老師知道。']] },
  'W4-03': { who: 'senior', item: 'candy', place: '操場', text: '幾個同學圍著你：「班上很多人都試過了，你不試就是膽小鬼！」', opts: [
    ['為了不被笑，只好試一下。', false, '', '為了面子傷害身體不值得，而且「很多人都試過」通常不是真的。'],
    ['「敢說不才是真的勇敢，我不需要靠這個證明自己。」', true, '自我肯定', '真正的勇敢，是在大家起鬨時還敢做對的選擇。'],
    ['騙他們說自己早就試過了。', false, '', '說謊會讓他們以後繼續找你，應該清楚拒絕。'],
    ['悶在心裡，誰都不說。', false, '', '被同學施壓要告訴老師或家人，大人可以幫你。']] },
  'W4-05': { who: 'netfriend', item: 'phone', place: '影片網站', text: '你在影片裡看到有人說「吃了這個，會看到彩色的世界」，覺得很好奇。', opts: [
    ['上網找哪裡可以買。', false, '', '好奇心不能用來試毒品。'],
    ['找同學一起試試看。', false, '', '會把同學也拉進危險裡。'],
    ['好奇時先問爸媽或老師正確的知識，不要自己試。', true, '用正確的方法滿足好奇心', '好奇是好事，用問的、用查正確資料的，不用身體去試。'],
    ['只試一點點就好。', false, '', '一點點也可能上癮或傷害大腦。']] },
  'W4-07': { who: 'senior', item: 'pill', place: '補習班', text: '考試快到了，學長說：「這個藥吃了可以整晚不睡讀書，成績會變好。」', opts: [
    ['考試比較重要，吃一次就好。', false, '', '來路不明的「提神藥」可能是毒品，會傷害大腦，反而更難專心。'],
    ['先買起來備用。', false, '', '買來路不明的藥很危險，也可能違法。'],
    ['介紹給成績不好的同學。', false, '', '會讓同學陷入危險。'],
    ['「我不要。我會早點睡、規律讀書，壓力大就去運動或畫畫。」', true, '健康紓壓', '睡飽、運動、畫畫和找人聊天，才是真正有效的紓壓方法。']] },
  'W4-09': { who: 'boyfriend', item: 'candy', place: '放學後', text: '好朋友說：「如果你不陪我一起試，我們就絕交！」', opts: [
    ['為了友情只好一起試。', false, '', '要你一起碰毒品的不是好朋友的做法。'],
    ['「真正的朋友不會害你。我不試，也希望你不要試，我們一起去找老師聊聊。」', true, '堅定拒絕＋關心朋友', '拒絕了誘惑，也沒有放棄朋友，還找了大人幫忙。'],
    ['先答應，之後再想辦法。', false, '', '答應了就很難拒絕，要當下說清楚。'],
    ['從此不理他，也不告訴任何人。', false, '', '朋友正在危險中，應該讓大人知道，才能幫助他。']] },
  'W5-03': { who: 'brother', item: 'coffee', place: '家裡', text: '你發現哥哥最近常躲在房間、脾氣很差，書包裡有奇怪的小包裝。', opts: [
    ['偷偷丟掉，假裝沒看到。', false, '', '丟掉不能解決問題，哥哥需要大人的幫助。'],
    ['告訴爸媽或信任的大人，請他們幫助哥哥。', true, '告訴信任的大人', '這不是告狀，是在救哥哥。大人知道了才能找專業協助。'],
    ['威脅哥哥要給你零用錢。', false, '', '這樣會讓事情更糟，哥哥也得不到幫助。'],
    ['自己打開檢查是什麼。', false, '', '不明物品不能碰，交給大人處理。']] },
  'W5-05': { who: 'friend', item: 'coffee', place: '教室', text: '好朋友小華偷偷告訴你，他試過一次「咖啡包」，還叫你千萬不能告訴別人。', opts: [
    ['遵守約定，誰都不說。', false, '', '這種祕密不能守，守住祕密反而可能害了他。'],
    ['在班上告訴所有同學。', false, '', '到處說會傷害小華，應該只告訴能幫忙的大人。'],
    ['罵他笨，然後不理他。', false, '', '他需要的是幫助和陪伴，不是被責罵。'],
    ['關心他：「這件事需要大人幫忙，我陪你去找輔導老師。」', true, '陪伴並尋求協助', '你的陪伴給了他勇氣，輔導老師會幫他找到正確的協助。']] },
  'W5-07': { who: 'stranger', item: 'drink', place: '社區活動', text: '社區活動時，有一個人喝了陌生人給的飲料後，說頭很暈、很不舒服。', opts: [
    ['馬上大聲叫附近的大人，請大人打 119。', true, '緊急求助', '緊急狀況先找大人、打 119，救援人員會用正確的方法救人。'],
    ['自己拿家裡的藥給他吃。', false, '', '亂吃藥可能讓情況更危險，應該交給專業。'],
    ['先拍照傳到群組。', false, '', '救人最重要，拍照會耽誤時間。'],
    ['因為害怕，趕快跑走，不告訴任何人。', false, '', '害怕是正常的，但一定要找大人求救。']] },
  'W5-09': { who: 'sister', item: 'phone', place: '社區', text: '鄰居姊姊說最近壓力很大，有陌生人一直傳訊息要賣她「放鬆小包」。她很害怕，不知道可以找誰幫忙。', opts: [
    ['告訴她自己忍耐就好。', false, '', '一個人硬撐很辛苦，遇到困難要找人幫忙。'],
    ['叫她去網路上問陌生人。', false, '', '網路上的陌生人不一定可靠。'],
    ['告訴她可以打免付費專線 0800-770-885（請請您，幫幫我）。', true, '求助專線', '0800-770-885 是各縣市毒品危害防制中心的免付費專線，遇到毒品相關的困擾都可以打來問。'],
    ['把她的事情告訴大家。', false, '', '遇到困難的人需要支持和尊重，不要到處說。']] },
  'W6-03': { who: 'friend', item: 'none', place: '學校', text: '學校舉辦反毒宣誓活動，同學說：「這很無聊，我們翹掉吧。」', opts: [
    ['「好啊，反正毒品跟我們沒關係。」', false, '', '毒品常偽裝成零食出現在身邊，學會保護自己很重要。'],
    ['「這是保護自己的約定，我想參加，也邀你一起來！」', true, '承諾與邀請', '你不只自己參加，還邀請了朋友，這就是反毒行動！'],
    ['一起翹掉去玩。', false, '', '錯過了學習保護自己的機會。'],
    ['去參加，但在下面講話。', false, '', '認真參與，才能學到怎麼保護自己。']] },
  'W6-05': { who: 'boyfriend', item: 'poster', place: '走廊', text: '你看到同學在班上的反毒海報上亂塗鴉。', opts: [
    ['跟著一起亂塗。', false, '', '海報是用來提醒大家的，破壞它就少了一份保護。'],
    ['不理他，走掉。', false, '', '好好說明，也許他就會明白。'],
    ['好好跟他說海報的意義，請他一起幫忙修好。', true, '說明與合作', '讓同學一起動手，他會更記得反毒的觀念。'],
    ['也把他的作業塗掉報復。', false, '', '報復只會讓事情變糟。']] },
  'W6-07': { who: 'senior', item: 'none', place: '公園', text: '有人說：「使用毒品只會傷害自己，又沒有違法。」', opts: [
    ['他說得對。', false, '', '在台灣，持有、使用毒品都是違法的。'],
    ['只要不被發現就沒關係。', false, '', '不管有沒有被發現，毒品都會傷害身體和家人。'],
    ['「不對！持有、使用毒品在台灣都是違法的，還會傷害身體和家人。」', true, '正確知識', '你用正確的知識回應了錯誤的說法。'],
    ['未成年就不會被處罰。', false, '', '未成年一樣會受到法律處理，而且身體傷害一樣存在。']] },
  'W6-09': { who: 'kid', item: 'none', place: '家裡', text: '小表弟問你：「為什麼毒品不能碰？試一次又不會怎樣。」', opts: [
    ['「你長大就知道了。」', false, '', '小朋友也需要知道正確的知識，才懂得保護自己。'],
    ['「試一次就知道了。」', false, '', '絕對不能鼓勵嘗試，一次就可能上癮。'],
    ['不理他。', false, '', '你學到的知識，可以保護身邊的人。'],
    ['耐心解釋毒品的傷害，再教他怎麼說「不」。', true, '把知識傳出去', '你成為了別人的拒毒小老師，這就是「我拒毒，也幫別人拒毒」！']] }
};
// 識破挑戰：選出所有符合的卡片 [圖示, 說明, 要不要選]
var ANTI_PICK = {
  'W1-06': { ask: '哪些東西「來路不明」，不能吃？（選出全部）', cards: [
    ['candy', '便利商店買的、包裝完整、有成分標示的牛奶糖', false], ['candy', '陌生人主動送的、包裝上沒有任何字的彩色糖果', true],
    ['fruit', '媽媽買回家、洗乾淨的水果', false], ['coffee', '同學說「加水喝了會很嗨」的小咖啡包', true],
    ['jelly', '營養午餐發的果凍', false], ['gummy', '網友寄來、包裝寫著看不懂外國字的「快樂軟糖」', true]],
    why: '來源不明、包裝奇怪、別人主動給、說吃了「很嗨」的東西都不能碰。' },
  'W2-06': { ask: '哪些可能是「偽裝的毒品」？（選出全部）', cards: [
    ['coffee', '沒有標示、印著卡通圖案、別人送的咖啡包', true], ['coffee', '家人在超市買的、有品牌和成分標示的即溶咖啡', false],
    ['pill', '醫生開的感冒藥，依照醫師指示服用', false], ['gummy', '陌生人說「吃了會很開心」的小熊軟糖', true],
    ['drink', '標籤被撕掉、別人給的「提神飲料」', true], ['vape', '筆狀的彩色電子煙和菸彈', true]],
    why: '新興毒品常偽裝成咖啡包、軟糖、飲料或菸彈。醫生開的藥要照醫師指示吃，才是正確用藥。' },
  'W3-06': { ask: '哪些是好的拒絕說法？（選出全部）', cards: [
    ['say', '「不要，我不碰毒品。」', true], ['say', '「我們去打球吧！」', true],
    ['say', '「我爸媽在等我，我先走了。」', true], ['say', '「好啦，只試一口。」', false],
    ['say', '「我考慮一下，下次再說。」', false], ['say', '「錢不夠，下次再跟你買。」', false]],
    why: '直接拒絕、轉移話題、離開現場都很好用；「下次再說」會讓對方一直來找你。' },
  'W4-06': { ask: '哪些是健康的紓壓方式？（選出全部）', cards: [
    ['ball', '去運動、打球、跑步', true], ['brush', '畫畫、聽音樂', true],
    ['talk', '跟家人或好朋友聊聊心事', true], ['candy', '吃別人給的、來路不明的「放鬆糖」', false],
    ['game', '熬夜打電動到天亮', false], ['vape', '吸電子煙', false]],
    why: '心情不好或壓力大時，運動、創作和找人聊天，都能讓自己好起來。' },
  'W5-06': { ask: '遇到毒品問題，可以找誰幫忙？（選出全部）', cards: [
    ['home', '爸媽或家人', true], ['school', '老師、輔導老師、學校護理師', true],
    ['phone', '免付費專線 0800-770-885', true], ['net', '網路上不認識的人', false],
    ['senior', '推銷東西的學長', false], ['alone', '自己默默處理，不讓任何人知道', false]],
    why: '遇到困難一定要找值得信任的大人，或撥打 0800-770-885（請請您，幫幫我）。' },
  'W6-06': { ask: '哪些是「反毒好行動」？（選出全部）', cards: [
    ['flag', '參加學校的反毒宣誓', true], ['poster', '設計一張反毒海報', true],
    ['talk', '教家人認識偽裝成零食的毒品', true], ['secret', '幫朋友保守碰毒品的祕密', false],
    ['share', '轉傳毒品的廣告給同學', false], ['laugh', '嘲笑正在努力戒毒的人', false]],
    why: '我拒毒，也幫別人拒毒。想戒毒的人需要的是支持，不是嘲笑。' }
};
// 淨化問答（魔王關前）：[題目, 選項, 正確索引, 說明]
var ANTI_QUIZ = {
  'W1-10': [['毒品會對身體造成什麼傷害？', ['讓人變得更聰明', '傷害大腦和身體，而且容易上癮', '讓人長得更高', '完全沒有影響'], 1, '毒品會傷害大腦、心臟等器官，而且很容易上癮。'],
    ['為什麼毒品「一次都不要試」？', ['因為很貴', '因為味道不好', '第一次就可能上癮或傷害身體', '因為大人說不行，沒有原因'], 2, '很多人都是從「試一次」開始上癮的。'],
    ['看到不明的藥丸、粉末或飲料，應該怎麼做？', ['不碰、不吃、不聞，告訴大人', '拿起來仔細看', '聞聞看是什麼味道', '收集起來'], 0, '不明物品「不碰、不吃、不聞」，交給大人處理。']],
  'W2-10': [['新興毒品常偽裝成什麼？', ['只有針筒', '只有白色粉末', '咖啡包、果凍、糖果等零食', '它們不會偽裝'], 2, '新興毒品會做成可愛的零食，讓人放下戒心。'],
    ['包裝很可愛、來源不明的零食，代表什麼？', ['一定很安全', '不一定安全，來源不明就不要吃', '一定是名牌', '可以先吃再說'], 1, '包裝越可愛越要小心，看來源和標示才準。'],
    ['電子煙在台灣是？', ['健康又安全的', '小朋友可以玩的', '被禁止的，而且可能被摻入毒品', '只要是水果口味就沒關係'], 2, '電子煙在台灣是禁止的，菸彈還可能被摻入毒品。']],
  'W3-10': [['「我們去打球吧！」是哪一種拒絕技巧？', ['直接拒絕', '轉移話題', '離開現場', '找大人幫忙'], 1, '用別的活動把話題岔開，就是轉移話題法。'],
    ['被一群人圍著勸你試毒品，最好的方法是？', ['留下來看看', '試一下讓他們放過你', '跟他們吵架', '馬上離開現場，去找大人'], 3, '人多的時候不要硬碰硬，離開現場最安全。'],
    ['拒絕的時候，應該怎麼說？', ['小聲說「可能吧」', '眼睛看著對方，語氣堅定地說「不」', '笑著先答應', '不說話'], 1, '清楚、堅定地拒絕，對方才知道你是認真的。']],
  'W4-10': [['朋友說「不試就是膽小鬼」，你怎麼想？', ['敢說不才是真勇敢', '只好試一下', '他說得對', '以後都不跟人說話'], 0, '在壓力下還能做對的選擇，就是勇敢。'],
    ['壓力很大時，健康的方法是？', ['吃別人給的「放鬆糖」', '熬夜不睡', '運動、畫畫、和家人聊天', '吸電子煙'], 2, '健康的紓壓方式能讓心情變好，又不會傷害身體。'],
    ['真正的朋友會怎麼做？', ['逼你一起試', '關心你，不會叫你碰毒品', '要你幫忙保守危險的祕密', '跟你借錢去買東西'], 1, '真正的朋友希望你平安、健康。']],
  'W5-10': [['反毒諮詢的免付費專線是？', ['0800-770-885（請請您，幫幫我）', '0800-123-456', '0911-111-111', '沒有這種專線'], 0, '0800-770-885 是各縣市毒品危害防制中心的免付費專線。'],
    ['有人吃了不明的東西後很不舒服，應該？', ['自己拿藥給他吃', '大聲叫大人，請大人打 119', '拍照上傳', '趕快走開'], 1, '緊急狀況先找大人、打 119。'],
    ['朋友告訴你他碰了毒品，你應該？', ['幫他保密', '告訴全班同學', '陪他一起去找信任的大人幫忙', '再也不理他'], 2, '陪伴和找大人幫忙，才是真正幫助朋友。']],
  'W6-10': [['在台灣，持有或使用毒品是？', ['合法的', '未成年就沒關係', '只要不被發現就好', '違法的'], 3, '持有、使用毒品在台灣都是違法的。'],
    ['想戒毒的人最需要的是？', ['支持和專業的協助', '被大家嘲笑', '被大家疏遠', '自己硬撐'], 0, '給他支持，並鼓勵他找專業協助。'],
    ['「拒毒萌芽小畫家」的承諾是？', ['只要我自己不碰就好', '好奇時試一點點', '我拒毒，也幫別人拒毒', '別人的事不用管'], 2, '你已經是守護無毒世界的小畫家了！']]
};
/** 某一關前面的拒毒活動（沒有就回傳 null） */

/* 劇情問答：沒有拒毒事件的關卡，劇情中間跳出的選擇題（答對得金幣、小芽會長大，不算徽章） */
var ANTI_STORY = {
  'W1-01': { cast: 'ade', who: 'kid', item: 'powder', place: '線條鎮', text: '看到來路不明的東西，要記住哪一個口訣？', opts: [
    ['不碰、不吃、不聞。', true, '拒毒口訣', '來路不明的東西可能藏著毒品，不碰、不吃、不聞最安全。'],
    ['先聞一聞，沒有怪味就能吃。', false, '', '有些毒品沒有味道，用聞的也可能吸進危險的東西。'],
    ['帶回家給家人嚐嚐看。', false, '', '不明的東西不要帶回家，也不要給別人吃。']] },
  'W1-02': { cast: 'ade', who: 'kid', item: 'pill', place: '素描教室', text: '毒品只試一次，也不行嗎？', opts: [
    ['不行，毒品會改變大腦，很容易上癮。', true, '一次都不要試', '毒品會讓大腦越來越想要它，很多人就是從「只試一次」開始停不下來。'],
    ['可以，只試一次不會怎樣。', false, '', '「只試一次」正是最常見的陷阱。'],
    ['朋友給的就沒關係。', false, '', '不管是誰給的，毒品都一樣危險。']] },
  'W1-04': { cast: 'stranger', who: 'stranger', item: 'powder', place: '巷口', text: '幫我把這個包裹送到巷口，給你一百塊零用錢！（不知道裡面裝什麼）怎麼做最好？', opts: [
    ['說「我媽媽在等我」，然後離開，告訴大人。', true, '藉故離開法', '不明的包裹可能藏著毒品，幫忙送也會惹上大麻煩。'],
    ['收下一百塊，送完就好。', false, '', '幫陌生人送不明包裹，可能變成幫壞人運毒。'],
    ['先打開包裹看看裡面是什麼。', false, '', '不要碰不明的東西，交給大人或警察處理。']] },
  'W1-08': { cast: 'ade', who: 'kid', item: 'pill', place: '阿德家', text: '我頭好痛，想自己拿家裡的藥來吃幾顆。該怎麼做？', opts: [
    ['先問家人，照醫生或藥師的指示吃。', true, '正確用藥', '藥一定要照指示使用，亂吃藥也會傷害身體。'],
    ['多吃幾顆，比較快好。', false, '', '吃太多藥非常危險。'],
    ['吃同學給的止痛藥。', false, '', '別人給的藥，不知道是什麼，不能吃。']] },
  'W2-01': { cast: 'ama', who: 'sister', item: 'candy', place: '彩虹市集', text: '買零食的時候，要認明哪些東西？', opts: [
    ['品牌、成分標示和保存期限。', true, '認明標示', '有清楚標示、從正常商店買的食物，才比較安心。'],
    ['包裝越可愛越好。', false, '', '毒品最喜歡用可愛的包裝偽裝。'],
    ['價錢越便宜越好。', false, '', '便宜又來路不明的東西，更要小心。']] },
  'W2-02': { cast: 'ama', who: 'sister', item: 'jelly', place: '彩虹市集', text: '包裝上看不清楚、沒寫清楚是什麼的食物，應該？', opts: [
    ['多一分小心，不清楚就不要吃。', true, '停、想、走開', '看不清楚來源和成分的食物，最好不要吃。'],
    ['先吃一口試試看。', false, '', '不明的食物可能摻了毒品，一口也危險。'],
    ['問網友能不能吃。', false, '', '網友不一定可信，應該問家人或老師。']] },
  'W2-04': { cast: 'mei', who: 'friend', item: 'pill', place: '調色工坊', text: '使用毒品會對身體造成什麼影響？', opts: [
    ['注意力和記憶變差，還會傷害心臟和牙齒。', true, '認識毒品', '毒品會傷害大腦和全身器官，還會上癮。'],
    ['會變得更聰明。', false, '', '這是謊話，毒品只會讓大腦變差。'],
    ['完全沒有影響。', false, '', '毒品對身體的傷害很大，而且很難恢復。']] },
  'W2-08': { cast: 'mei', who: 'friend', item: 'drink', place: '彩虹市集', text: '飲料離開過自己的視線，應該怎麼做？', opts: [
    ['不要再喝，重新拿一杯。', true, '保護自己', '有人可能趁你不注意，偷偷放東西進去。'],
    ['看起來一樣，就繼續喝。', false, '', '加了東西的飲料，看起來可能一模一樣。'],
    ['拿給朋友喝。', false, '', '不安全的飲料，也不要給別人喝。']] },
  'W3-01': { cast: 'kai', who: 'boyfriend', item: 'popcandy', place: '構圖畫廊', text: '學長威脅我，如果不跟他們一起，就要弄壞我的畫……最好的做法是？', opts: [
    ['先讓自己安全，再告訴信任的大人。', true, '尋求協助法', '被威脅不是你的錯，大人會保護你。'],
    ['自己一個人忍下來。', false, '', '一個人忍耐，情況可能越來越糟。'],
    ['乖乖聽學長的話。', false, '', '聽從威脅只會讓自己陷入危險。']] },
  'W3-02': { cast: 'kai', who: 'boyfriend', item: 'popcandy', place: '構圖畫廊', text: '朋友想試毒品，用「友誼勸誘法」可以怎麼說？', opts: [
    ['「我很在乎你，所以不希望你碰毒品。」', true, '友誼勸誘法', '用關心的話，讓朋友知道你是為他好。'],
    ['「隨便你，我不管了。」', false, '', '放著不管，朋友可能會受到傷害。'],
    ['「那我陪你一起試。」', false, '', '陪著試，兩個人都會受傷。']] },
  'W3-04': { cast: 'xiang', who: 'senior', item: 'popcandy', place: '構圖畫廊', text: '被笑「膽小鬼」的時候，哪一句是「自我解嘲法」？', opts: [
    ['「對啊，我就是膽小，因為我很愛惜我的大腦！」', true, '自我解嘲法', '用輕鬆的話化解，不必跟對方吵架，也不會被激怒。'],
    ['「誰說我膽小，我試給你看！」', false, '', '被激將而去試，正中對方的下懷。'],
    ['跟他大吵一架。', false, '', '吵架可能讓情況更危險，冷靜離開比較好。']] },
  'W3-08': { cast: 'hua', who: 'friend', item: 'popcandy', place: '構圖畫廊', text: '和朋友一起組「拒毒小隊」，有什麼好處？', opts: [
    ['互相支持，更有勇氣說「不」。', true, '團結的力量', '有朋友站在一起，拒絕會更容易。'],
    ['可以一起偷偷試。', false, '', '拒毒小隊是互相保護，不是一起冒險。'],
    ['沒有任何差別。', false, '', '研究發現，朋友的支持能幫助大家遠離毒品。']] },
  'W4-01': { cast: 'qing', who: 'seniorgirl', item: 'candy', place: '曲線畫室', text: '心情不好的時候，可以怎麼照顧自己？', opts: [
    ['找家人朋友聊聊、運動或畫畫。', true, '健康紓壓', '健康的方法能讓心情變好，也不會傷害自己。'],
    ['吃別人給的「開心糖」。', false, '', '號稱讓人開心的糖果，可能摻了毒品。'],
    ['一個人關在房間，不跟任何人說。', false, '', '把心事說出來，才有人能幫助你。']] },
  'W4-02': { cast: 'qing', who: 'seniorgirl', item: 'pill', place: '曲線畫室', text: '比賽前很緊張，哪一個是好方法？', opts: [
    ['慢慢深呼吸：吸氣數到四，再慢慢吐氣。', true, '健康紓壓', '深呼吸能讓身體和心情放鬆下來。'],
    ['吃來路不明的放鬆藥。', false, '', '不明的藥可能是毒品，會傷害身體。'],
    ['熬夜打電動。', false, '', '睡不飽會讓人更緊張、更疲累。']] },
  'W4-04': { cast: 'qing', who: 'netfriend', item: 'pill', place: '曲線畫室', text: '網路上說「用了某些東西，畫圖會更有靈感」，這是真的嗎？', opts: [
    ['假的，毒品只會讓人失去判斷力。', true, '反說服法', '真正的靈感來自練習和生活，不是藥物。'],
    ['真的，很多人都這樣說。', false, '', '網路上的說法不一定正確，要查證。'],
    ['試試看才知道。', false, '', '毒品不能「試試看」，一次就可能上癮。']] },
  'W4-08': { cast: 'cousin', who: 'cousin', item: 'powder', place: '曲線畫室', text: '「這是植物做的，很天然，所以很安全。」這句話對嗎？', opts: [
    ['不對，很多毒品來自植物，天然不代表安全。', true, '反說服法', '大麻、古柯鹼都來自植物，一樣會傷害身體、讓人上癮。'],
    ['對，天然的東西都安全。', false, '', '天然的東西也可能有毒。'],
    ['不知道，吃一點看看。', false, '', '不確定的東西，一點都不要吃。']] },
  'W5-01': { cast: 'kui', who: 'sister', item: 'powder', place: '節點工坊', text: '我好擔心哥哥。把擔心說出來，會不會是背叛他？', opts: [
    ['不會，說出來是在幫助他。', true, '尋求協助法', '家人知道了，才能一起想辦法幫助他。'],
    ['會，所以要保守祕密。', false, '', '幫忙隱瞞，可能讓哥哥受到更大的傷害。'],
    ['去問網友該怎麼辦。', false, '', '應該找信任的大人，而不是陌生網友。']] },
  'W5-02': { cast: 'teacher', who: 'sister', item: 'powder', place: '回家的路', text: '發現身邊的人可能需要幫助，應該怎麼做？', opts: [
    ['不亂猜、不自己處理，告訴信任的大人。', true, '尋求協助法', '大人有能力也有方法，可以提供正確的幫助。'],
    ['到處跟同學說。', false, '', '到處說會傷害對方，也解決不了問題。'],
    ['自己去翻他的東西。', false, '', '自己處理可能有危險，交給大人比較安全。']] },
  'W5-04': { cast: 'kui', who: 'sister', item: 'powder', place: '節點工坊', text: '如果家人碰了毒品，我們應該？', opts: [
    ['遠離毒品，但關心他，也請大人一起幫忙。', true, '關心與支持', '需要幫助的人，最需要的是陪伴和專業協助。'],
    ['嘲笑他，不理他。', false, '', '嘲笑和排擠只會讓他更難回頭。'],
    ['幫他保守祕密。', false, '', '保守祕密會耽誤他得到幫助的機會。']] },
  'W5-08': { cast: 'jie', who: 'brother', item: 'pill', place: '節點工坊', text: '晚上心裡很煩、想找人聊聊，可以打哪一支專線？', opts: [
    ['0800-770-885（請請您，幫幫我）', true, '求助專線', '這是免付費的專線，有專人可以聽你說、提供協助。'],
    ['問網路上的陌生人。', false, '', '陌生人不一定可靠，可能讓你更危險。'],
    ['不跟任何人說。', false, '', '說出來才有人能幫你。']] },
  'W6-01': { cast: 'dean', who: 'friend', item: 'powder', place: '宮廷畫院', text: '對抗毒品，什麼力量最大？', opts: [
    ['大家團結，互相提醒、互相幫忙。', true, '團結的力量', '每個人都多一分注意，毒品就少一分機會。'],
    ['每個人自己躲起來。', false, '', '躲起來無法解決問題。'],
    ['等灰霾自己離開。', false, '', '毒霧不會自己消失，需要大家一起行動。']] },
  'W6-02': { cast: 'ade', who: 'friend', item: 'candy', place: '宮廷畫院', text: '怎麼樣才能讓更多人一起拒毒？', opts: [
    ['分享正確的知識，邀請大家一起參加。', true, '反毒小尖兵', '把知道的事教給別人，大家都能保護自己。'],
    ['只顧好自己就好。', false, '', '身邊的人也需要你的提醒。'],
    ['轉傳毒品的廣告。', false, '', '轉傳廣告會讓更多人受騙。']] },
  'W6-04': { cast: 'dean', who: 'friend', item: 'powder', place: '宮廷畫院', text: '在校園裡發現可疑的人或東西，應該？', opts: [
    ['馬上告訴老師。', true, '尋求協助法', '老師和學校會用安全的方法處理。'],
    ['自己去追查。', false, '', '自己追查可能遇到危險。'],
    ['拍照上傳網路就好。', false, '', '上傳網路不能解決問題，應該告訴大人。']] },
  'W6-08': { cast: 'kai', who: 'boyfriend', item: 'candy', place: '宮廷畫院', text: '拒毒小隊的徽章，最重要的意義是？', opts: [
    ['提醒自己，也提醒別人拒絕毒品。', true, '反毒小尖兵', '徽章代表一個約定：我拒毒，也幫別人拒毒。'],
    ['讓自己看起來很酷。', false, '', '徽章的意義比好看更重要。'],
    ['可以拿去換零食。', false, '', '徽章是約定，不是交換的東西。']] }
};
/** 老師用編輯器修改過的題庫：套用到上面四張表（前端由 content.js 套用，後端由試算表屬性套用） */
var QBANK_VER = '';
function applyQuestionBank(b) {
  if (!b) return;
  var T = { tempt: ANTI_TEMPT, pick: ANTI_PICK, quiz: ANTI_QUIZ, story: ANTI_STORY };
  Object.keys(T).forEach(function (k) { if (b[k]) Object.keys(b[k]).forEach(function (id) { if (T[k][id]) T[k][id] = b[k][id]; }); });
  QBANK_VER = String(b.qver || '');
}
function antiEventOf(levelId) {
  if (ANTI_TEMPT[levelId]) return { type: 'tempt', id: 'T:' + levelId, data: ANTI_TEMPT[levelId] };
  if (ANTI_PICK[levelId]) return { type: 'pick', id: 'P:' + levelId, data: ANTI_PICK[levelId] };
  if (ANTI_QUIZ[levelId]) return { type: 'quiz', id: 'Q:' + levelId, data: ANTI_QUIZ[levelId] };
  if (ANTI_STORY[levelId]) return { type: 'story', id: 'S:' + levelId, data: ANTI_STORY[levelId] };
  return null;
}
/** 全部徽章數：誘惑事件與識破挑戰各 1 枚，問答每題 1 枚 */
var ANTI_TOTAL = Object.keys(ANTI_TEMPT).length + Object.keys(ANTI_PICK).length + Object.keys(ANTI_QUIZ).length * 3;
/** 檢查答案。eventId：T:W1-03、P:W1-06、Q:W1-10:0 */
function antiCheck(eventId, answer) {
  var m = /^([TPQS]):(W\d-\d\d)(?::(\d))?$/.exec(String(eventId || '')); if (!m) return null;
  if (m[1] === 'T' || m[1] === 'S') { var t = (m[1] === 'T' ? ANTI_TEMPT : ANTI_STORY)[m[2]]; if (!t) return null; var o = t.opts[Number(answer)]; return o ? !!o[1] : null; }
  if (m[1] === 'P') { var p = ANTI_PICK[m[2]]; if (!p || !Array.isArray(answer)) return null; var want = p.cards.map(function (c, i) { return c[2] ? i : -1; }).filter(function (i) { return i >= 0; }); var got = answer.map(Number).sort(); return want.length === got.length && want.every(function (v, i) { return v === got[i]; }); }
  var q = ANTI_QUIZ[m[2]] && ANTI_QUIZ[m[2]][Number(m[3])]; if (!q) return null; return Number(answer) === q[2];
}
function antiReward(eventId, levelOrder) { return eventId.charAt(0) === 'Q' ? Math.max(10, levelReplayGold(levelOrder) * 2) : Math.max(15, levelReplayGold(levelOrder) * 3); }
function badgeCount(b) { b = b || {}; return Object.keys(b).filter(function (k) { return k.charAt(0) !== 'S' && b[k] && b[k].ok; }).length; }
/** 小芽成長：所有劇情裡的問答（含拒毒事件與劇情問答）答對的數量 */
var SPROUT_TOTAL = ANTI_TOTAL + Object.keys(ANTI_STORY).length;
function sproutCount(b) { b = b || {}; return Object.keys(b).filter(function (k) { return b[k] && b[k].ok; }).length; }
/** 成長階段 0～4（小芽→三片葉→茂盛→花苞→開花） */
function sproutStage(n) { return n >= 60 ? 4 : n >= 42 ? 3 : n >= 24 ? 2 : n >= 8 ? 1 : 0; }

function levelsToRows() {
  return LEVELS.map(function (l) {
    return [l.id, l.world, l.order, l.title, l.kind, l.tools.join(','), l.pass, l.star3, l.npc, l.hint,
      JSON.stringify({ boss: !!l.boss, creative: !!l.creative, palette: l.palette, phases: l.phases })];
  });
}
function levelFromRow(o) {
  var extra = {}; try { extra = JSON.parse(o.Phases_JSON || '{}'); } catch (e) { extra = {}; }
  return {
    id: String(o.Level_ID), world: Number(o.World_ID) || 1, order: Number(o.Order) || 0, title: String(o.Title || ''), kind: String(o.Kind || ''),
    tools: String(o.Tools || 'select').split(',').map(function (s) { return s.trim(); }).filter(Boolean),
    pass: Number(o.Pass) || 0.9, star3: Number(o.Star3_Steps) || 5, npc: String(o.NPC_Dialogue || ''), hint: String(o.Hint || ''),
    boss: !!extra.boss, creative: !!extra.creative, palette: extra.palette || [INK], phases: extra.phases || []
  };
}

/* ---------------- 示範資料 ---------------- */
function demoSeedRows(nowIso) {
  var stu = function (cls, seat, name, pw, gold, cur, stars, look, owned, pets) {
    return [cls + '_' + seat, cls, seat, name, pw, '', gold, cur, 0, JSON.stringify(stars || {}), JSON.stringify(Object.assign({}, DEFAULT_LOOK, look || {})), '{}', nowIso, JSON.stringify(owned || []), '{}', JSON.stringify(pets || {})];
  };
  return {
    Classes: [
      ['601', '六年一班', 'OPEN', '00:00', '23:59', 999, '歡迎來到拒毒萌芽小畫家！完成素描教室十關，吹散毒霧魔王就能晉升「識毒小畫家」。', nowIso],
      ['602', '六年二班', 'OPEN', '08:00', '17:00', 10, '', nowIso]
    ],
    Students: [
      stu('601', '01', '林小宇', '1234', 50, 'W1-01', {}),
      stu('601', '02', '陳小華', '1234', 180, 'W1-04', { 'W1-01': 3, 'W1-02': 3, 'W1-03': 2 }, { hairStyle: 'twin', hair: '#1f1a24', eyes: 'big', hat: 'hat-cat', outfit: 'smock#e0627a', pet: 'pet-chick' }, ['hat-cat', 'pet-chick'], { 'pet-chick': ['S:W1-01', 'S:W1-02', 'T:W1-03', 'demo-1', 'demo-2'] }),
      stu('601', '03', '張大衛', '0303', 420, 'W1-07', { 'W1-01': 3, 'W1-02': 3, 'W1-03': 3, 'W1-04': 3, 'W1-05': 2, 'W1-06': 3 }, { skin: '#e8b48a', hairStyle: 'spiky', hair: '#8a5a35', hat: 'hat-paper', outfit: 'out-hoodie', face: 'face-glass', brush: 'brush-pencil' }, ['hat-paper', 'out-hoodie', 'face-glass', 'brush-pencil']),
      stu('602', '01', '王小美', '1234', 50, 'W1-01', {})
    ],
    Live_Feed: [[nowIso, 'ALL', 'SYSTEM', '🌱 拒毒萌芽小畫家開學了！一起畫出無毒的美麗世界吧！']],
    Admin: [['admin', '8888', '美術老師', '']]
  };
}

/* ============================================================================
 * 後端商業邏輯
 * env：{ db, cache, lock(fn), uuid(), nowIso(), nowHM() }
 *   db.rows(name) → 含標題列的二維陣列（同一個請求內可重複呼叫）
 *   db.set(name, r, c, v)、db.setRow(name, r, arr)、db.append(name, arr)、db.del(name, r)
 * ========================================================================== */
function makeServer(env) {
  var db = env.db, cache = env.cache;
  function col(name, key) { return HEADERS[name].indexOf(key); }
  function table(name) {
    var rows = db.rows(name), h = rows[0] || HEADERS[name];
    return rows.slice(1).map(function (r, i) { var o = { _r: i + 1 }; h.forEach(function (k, j) { o[k] = r[j]; }); return o; });
  }
  function setF(name, r, key, v) { db.set(name, r, col(name, key), v); }
  function pj(s, fb) { try { var v = typeof s === 'string' ? JSON.parse(s || 'null') : s; return v == null ? fb : v; } catch (e) { return fb; } }
  function pad2(s) { s = String(s == null ? '' : s).trim(); return /^\d+$/.test(s) ? s.padStart(2, '0') : s; }
  function cacheJSON(key, sec, make) {
    var v = cache.get(key); if (v) { try { return JSON.parse(v); } catch (e) {} }
    var data = make(); try { cache.put(key, JSON.stringify(data), sec); } catch (e) {}
    return data;
  }
  function hm(v, fb) {
    if (v instanceof Date) return String(v.getHours()).padStart(2, '0') + ':' + String(v.getMinutes()).padStart(2, '0');
    var s = String(v == null ? '' : v).trim(), m = s.match(/(\d{1,2}):(\d{2})/);
    return m ? m[1].padStart(2, '0') + ':' + m[2] : fb;
  }

  /* ---- 班級 ---- */
  function classes() {
    return cacheJSON('PA_CLASSES', 30, function () {
      var out = {};
      table(SHEETS.CLASSES).forEach(function (c) {
        var id = String(c.Class_ID).trim(); if (!id) return;
        out[id] = { classId: id, name: String(c.Class_Name || id), status: String(c.Status || 'OPEN').toUpperCase(), start: hm(c.Allowed_Time_Start, '00:00'), end: hm(c.Allowed_Time_End, '23:59'), maxLevel: maxLevelOf(c.Max_Level_Limit), broadcast: String(c.Teacher_Broadcast || '') };
      });
      return out;
    });
  }
  function playable(ci) {
    if (!ci) return { ok: false, reason: '找不到這個班級。' };
    if (ci.status === 'CLOSED') return { ok: false, reason: '老師目前關閉了本班的學院大門。' };
    var now = env.nowHM();
    if (now < ci.start || now > ci.end) return { ok: false, reason: '目前不是本班的開放時間（' + ci.start + '～' + ci.end + '）。' };
    return { ok: true };
  }

  /* ---- 關卡 ---- */
  function levels() {
    return cacheJSON('PA_LEVELS_' + LEVELS_VERSION, 300, function () {
      return table(SHEETS.LEVELS).map(levelFromRow).filter(function (l) { return l.id; }).sort(function (a, b) { return a.order - b.order; });
    });
  }
  function levelMap() { var m = {}; levels().forEach(function (l, i) { l.n = i + 1; m[l.id] = l; }); return m; }
  function readyLevels() { return levels().filter(function (l) { var w = WORLDS[l.world - 1]; return w && w.ready; }); }

  /* ---- 學生 ---- */
  function findStudent(id) { var s = table(SHEETS.STUDENTS).filter(function (r) { return String(r.Student_ID) === String(id); })[0]; return s || null; }
  function studentOut(s) {
    return {
      studentId: String(s.Student_ID), classId: String(s.Class_ID), seatNo: pad2(s.Seat_No), name: String(s.Name),
      gold: Number(s.Gold) || 0, currentLevel: String(s.Current_Level || 'W1-01'), failCount: Number(s.Current_Fail_Count) || 0,
      stars: pj(s.Cleared_Stars_JSON, {}), look: lookStage(normalizeLook(pj(s.Look_JSON, {}), pj(s.Owned_JSON, [])), pj(s.Pets_JSON, {})), hints: pj(s.Hints_JSON, {}), owned: pj(s.Owned_JSON, []), badges: pj(s.Badges_JSON, {}), pets: pj(s.Pets_JSON, {})
    };
  }
  function tokenOk(studentId, token) {
    var key = 'PA_TOKEN_' + studentId, t = cache.get(key);
    if (!t) { var s = findStudent(studentId); if (!s) return false; t = String(s.Session_Token || ''); cache.put(key, t, 300); }
    return t && t === String(token);
  }
  function kicked() { return { status: 'kicked', message: '你的帳號剛剛在另一台裝置登入，這個畫面已經安全登出。' }; }

  /* ---- 動態牆與全班進度 ---- */
  function feed(classId) {
    return cacheJSON('PA_FEED_' + classId, 20, function () {
      var rows = table(SHEETS.FEED).filter(function (f) { var c = String(f.Class_ID); return c === 'ALL' || c === String(classId); });
      return rows.slice(-12).reverse().map(function (f) { return { time: String(f.Event_Time), type: String(f.Type), message: String(f.Message) }; });
    });
  }
  function addFeed(classId, type, msg) {
    db.append(SHEETS.FEED, [env.nowIso(), classId, type, msg]);
    cache.del('PA_FEED_' + classId); cache.del('PA_FEED_ALL');
  }
  function progress(classId) {
    return cacheJSON('PA_PROG_' + classId, 8, function () {
      var at = {}, cleared = {}, three = {}, present = {}, total = 0;
      table(SHEETS.STUDENTS).forEach(function (s) {
        if (String(s.Class_ID) !== String(classId)) return; total++;
        var cur = String(s.Current_Level || 'W1-01'); at[cur] = (at[cur] || 0) + 1;
        var st = pj(s.Cleared_Stars_JSON, {});
        Object.keys(st).forEach(function (k) { cleared[k] = (cleared[k] || 0) + 1; if (st[k] >= 3) (three[k] = three[k] || []).push(String(s.Name)); });
        // 站在島上的同學（3D 地圖的立牌）：目前關卡、而且還沒通過
        if (!st[cur]) (present[cur] = present[cur] || []).push({ id: String(s.Student_ID), name: String(s.Name), look: lookStage(normalizeLook(pj(s.Look_JSON, {})), pj(s.Pets_JSON, {})) });
      });
      return { total: total, at: at, cleared: cleared, threeStar: three, present: present };
    });
  }

  /* ---- 學生端 API ---- */
  var H = {};
  H.ping = function () { return { status: 'ok', message: '拒毒萌芽小畫家雲端後端運作正常', version: PA_VERSION, levelsVersion: LEVELS_VERSION, levels: levels().length, time: env.nowIso() }; };
  H.getClassList = function () {
    var c = classes();
    return { status: 'ok', classes: Object.keys(c).sort().map(function (k) { return { classId: k, name: c[k].name }; }) };
  };
  H.studentLogin = function (req) {
    var classId = String(req.classId || '').trim(), seat = pad2(req.seatNo), pw = String(req.password || '').trim();
    var ci = classes()[classId], chk = playable(ci);
    if (!chk.ok) return { status: 'locked', message: chk.reason };
    return env.lock(function () {
      var s = table(SHEETS.STUDENTS).filter(function (r) { return String(r.Class_ID).trim() === classId && pad2(r.Seat_No) === seat; })[0];
      if (!s) return { status: 'error', message: '在 ' + (ci ? ci.name : classId) + ' 找不到座號 ' + seat + ' 的同學。' };
      var real = String(s.Password).trim();
      var ok = real === pw || (/^\d+$/.test(real) && /^\d+$/.test(pw) && real.padStart(pw.length, '0') === pw);
      if (!ok) return { status: 'error', message: '密碼不對喔！忘記密碼請舉手問老師。' };
      var tok = env.uuid();
      setF(SHEETS.STUDENTS, s._r, 'Session_Token', tok); setF(SHEETS.STUDENTS, s._r, 'Last_Active_Time', env.nowIso());
      cache.put('PA_TOKEN_' + s.Student_ID, tok, 300);
      s.Session_Token = tok;
      var out = studentOut(s); out.sessionToken = tok;
      return { status: 'ok', student: out, classInfo: ci, levels: levels(), worlds: WORLDS, ranks: RANKS, feed: feed(classId), progress: progress(classId) };
    });
  };
  H.heartbeat = function (req) {
    if (!tokenOk(req.studentId, req.sessionToken)) return kicked();
    var ci = classes()[String(req.classId)], chk = playable(ci);
    var st = !chk.ok ? 'locked' : (ci.status === 'FREEZE' ? 'freeze' : 'ok');
    var key = 'PA_ACTIVE_' + req.studentId;
    if (!cache.get(key)) {   // 每 2 分鐘最多寫一次「最後上線時間」
      var s = findStudent(req.studentId); if (s) setF(SHEETS.STUDENTS, s._r, 'Last_Active_Time', env.nowIso());
      cache.put(key, '1', 120);
    }
    return { status: st, reason: chk.reason || '', classInfo: ci, feed: feed(req.classId), progress: progress(req.classId) };
  };
  H.reportFail = function (req) {
    if (!tokenOk(req.studentId, req.sessionToken)) return kicked();
    return env.lock(function () {
      var s = findStudent(req.studentId); if (!s) return { status: 'error', message: '找不到帳號' };
      if (String(s.Current_Level) === String(req.levelId)) setF(SHEETS.STUDENTS, s._r, 'Current_Fail_Count', (Number(s.Current_Fail_Count) || 0) + 1);
      return { status: 'ok' };
    });
  };
  H.useHint = function (req) {
    if (!tokenOk(req.studentId, req.sessionToken)) return kicked();
    var lv = levelMap()[req.levelId]; if (!lv) return { status: 'error', message: '找不到這一關' };
    return env.lock(function () {
      var s = findStudent(req.studentId); if (!s) return { status: 'error', message: '找不到帳號' };
      var hints = pj(s.Hints_JSON, {}), gold = Number(s.Gold) || 0, price = hintPriceOf(lv.n);
      if (hints[lv.id]) return { status: 'ok', gold: gold, hints: hints, price: 0 };
      if (gold < price) return { status: 'error', message: '金幣不夠，提示需要 ' + price + ' 枚。' };
      gold -= price; hints[lv.id] = true;
      setF(SHEETS.STUDENTS, s._r, 'Gold', gold); setF(SHEETS.STUDENTS, s._r, 'Hints_JSON', JSON.stringify(hints));
      return { status: 'ok', gold: gold, hints: hints, price: price };
    });
  };
  H.saveLook = function (req) {
    if (!tokenOk(req.studentId, req.sessionToken)) return kicked();
    return env.lock(function () {
      var s = findStudent(req.studentId); if (!s) return { status: 'error', message: '找不到帳號' };
      var lk = normalizeLook(req.look, pj(s.Owned_JSON, [])); delete lk.petStage; setF(SHEETS.STUDENTS, s._r, 'Look_JSON', JSON.stringify(lk)); cache.del('PA_PROG_' + s.Class_ID);
      return { status: 'ok', look: lookStage(lk, pj(s.Pets_JSON, {})) };
    });
  };
  // 拒毒事件：誘惑事件、識破挑戰、淨化問答。答對得徽章，第一次就答對再加金幣
  /** 題庫（老師自訂版）存在 env.kv；每次執行只讀一次 */
  var bankLoaded = false;
  function loadBank() {
    if (bankLoaded || !env.kv) return; bankLoaded = true;
    var b = pj(env.kv.get('PA_QBANK'), null); if (b) applyQuestionBank(b);
  }
  /** 老師的編輯器把題庫發佈到後台 */
  H.saveContent = function (req) {
    if (!adminOk(req.token)) return denied();
    if (!env.kv) return { status: 'error', message: '這個後端不支援自訂題庫。' };
    var b = req.bank || {}, n = 0;
    try { ['tempt', 'pick', 'quiz', 'story'].forEach(function (k) { n += Object.keys(b[k] || {}).length; }); } catch (e) { return { status: 'error', message: '題庫格式錯誤。' }; }
    env.kv.set('PA_QBANK', n ? JSON.stringify(b) : '');
    return { status: 'ok', count: n, qver: String(b.qver || '') };
  };
  H.answerEvent = function (req) {
    loadBank();
    if (env.kv && String(req.qv || '') !== QBANK_VER) return { status: 'error', message: QBANK_VER ? '題庫已經更新，請重新整理網頁再作答。' : '題庫還沒有發佈到後台，請老師在編輯器按「發佈題庫到後台」。' };
    if (!tokenOk(req.studentId, req.sessionToken)) return kicked();
    var id = String(req.eventId || ''), ok = antiCheck(id, req.answer);
    if (ok === null) return { status: 'error', message: '找不到這個事件。' };
    var lv = levels().filter(function (l) { return l.id === id.substr(2, 5); })[0]; if (!lv) return { status: 'error', message: '找不到這個關卡。' };
    return env.lock(function () {
      var s = findStudent(req.studentId); if (!s) return { status: 'error', message: '找不到帳號' };
      var b = pj(s.Badges_JSON, {}), rec = b[id] || { a: 0, ok: 0 }, gold = Number(s.Gold) || 0, earned = 0, newBadge = false, grew = false;
      if (!rec.ok) {
        rec.a++;
        if (ok) { rec.ok = 1; grew = true; newBadge = id.charAt(0) !== 'S'; if (rec.a === 1) { earned = antiReward(id, lv.order); gold += earned; setF(SHEETS.STUDENTS, s._r, 'Gold', gold); } }
        b[id] = rec; setF(SHEETS.STUDENTS, s._r, 'Badges_JSON', JSON.stringify(b));
        var n = badgeCount(b);
        if (newBadge && (n === ANTI_TOTAL || n % 10 === 0)) addFeed(String(s.Class_ID), 'BADGE', '🛡 ' + s.Name + ' 已經收集了 ' + n + ' 枚拒毒徽章！');
      }
      // 夥伴成長：帶著夥伴答對（含複習），同一題每隻夥伴只算一次
      var pets = pj(s.Pets_JSON, {}), pet = null;
      if (ok) {
        var lk = normalizeLook(pj(s.Look_JSON, {}), pj(s.Owned_JSON, []));
        pet = petGain(pets, lk.pet, id);
        if (pet && pet.gained) { setF(SHEETS.STUDENTS, s._r, 'Pets_JSON', JSON.stringify(pets)); if (pet.evolved) { cache.del('PA_PROG_' + s.Class_ID); addFeed(String(s.Class_ID), 'BADGE', '✨ ' + s.Name + ' 的夥伴進化成「' + pet.name + '」了！'); } }
      }
      return { status: 'ok', correct: ok, gold: gold, goldEarned: earned, newBadge: newBadge, grew: grew, sprout: sproutCount(b), badges: b, badgeCount: badgeCount(b), pet: pet, pets: pets };
    });
  };
  // 畫具商店：用金幣買一件商品
  H.buyItem = function (req) {
    if (!tokenOk(req.studentId, req.sessionToken)) return kicked();
    var it = SHOP_MAP[req.itemId]; if (!it) return { status: 'error', message: '找不到這件商品。' };
    return env.lock(function () {
      var s = findStudent(req.studentId); if (!s) return { status: 'error', message: '找不到帳號' };
      var owned = pj(s.Owned_JSON, []), gold = Number(s.Gold) || 0;
      if (ownsItem(owned, it.id)) return { status: 'ok', gold: gold, owned: owned, already: true };
      var rk = rankOf(pj(s.Cleared_Stars_JSON, {}), levels());
      if (rk < it.rank) return { status: 'error', message: '「' + it.name + '」要晉升為「' + RANKS[it.rank] + '」才能購買。' };
      if (it.badge && badgeCount(pj(s.Badges_JSON, {})) < it.badge) return { status: 'error', message: '「' + it.name + '」要集滿 ' + it.badge + ' 枚拒毒徽章才能領取。' };
      if (gold < it.price) return { status: 'error', message: '金幣不夠，「' + it.name + '」需要 ' + it.price + ' 枚，你有 ' + gold + ' 枚。' };
      gold -= it.price; owned.push(it.id);
      setF(SHEETS.STUDENTS, s._r, 'Gold', gold); setF(SHEETS.STUDENTS, s._r, 'Owned_JSON', JSON.stringify(owned));
      if (it.price >= 20000) addFeed(String(s.Class_ID), 'SHOP', '🛍 ' + s.Name + ' 在畫具商店買下了「' + it.name + '」！');
      return { status: 'ok', gold: gold, owned: owned, item: it.id };
    });
  };
  H.getClassProgress = function (req) {
    if (!tokenOk(req.studentId, req.sessionToken)) return kicked();
    return { status: 'ok', progress: progress(req.classId) };
  };
  H.getHonorRoll = function (req) {
    var p = progress(req.classId); return { status: 'ok', names: (p.threeStar[req.levelId] || []).slice(0, 20) };
  };
  H.submitClear = function (req) {
    if (!tokenOk(req.studentId, req.sessionToken)) return kicked();
    var lm = levelMap(), lv = lm[req.levelId];
    if (!lv) return { status: 'error', message: '找不到這一關。' };
    return env.lock(function () {
      var s = findStudent(req.studentId); if (!s) return { status: 'error', message: '找不到帳號' };
      var ci = classes()[String(s.Class_ID)], chk = playable(ci);
      if (!chk.ok) return { status: 'locked', message: chk.reason };
      if (lv.n > maxLevelOf(ci.maxLevel)) return { status: 'error', message: '老師目前只開放到第 ' + ci.maxLevel + ' 關。' };
      var stars = pj(s.Cleared_Stars_JSON, {}), cur = lm[String(s.Current_Level)] || readyLevels()[0];
      if (!stars[lv.id] && cur && lv.n > cur.n) return { status: 'error', message: '請先完成前面的關卡。' };
      var works = req.works;
      if (!Array.isArray(works) || works.length !== lv.phases.length) return { status: 'error', message: '作品資料不完整，請再提交一次。' };
      for (var i = 0; i < works.length; i++) {
        var chkR = checkRules(works[i], lv.phases[i].rules);
        if (!chkR.ok) return { status: 'error', message: '第 ' + (i + 1) + ' 幅：' + chkR.msg };
      }
      var acc = Number(req.accuracy) || 0;
      if (acc + 0.005 < lv.pass) return { status: 'error', message: '相似度還沒達到過關線。' };
      var hints = pj(s.Hints_JSON, {}), hintUsed = !!hints[lv.id], fails = Math.max(0, Number(req.fails) || 0), steps = Math.max(0, Number(req.steps) || 0);
      var got = 1; if (fails === 0 && !hintUsed) got = 2; if (got === 2 && steps <= lv.star3) got = 3;
      var prev = Number(stars[lv.id]) || 0, isFirst = prev === 0, isUp = !isFirst && got > prev;
      var gold = calcClearGold(lv.n, got, prev), total = (Number(s.Gold) || 0) + gold;
      stars[lv.id] = Math.max(prev, got);
      var all = readyLevels(), idx = all.map(function (l) { return l.id; }).indexOf(lv.id);
      var next = idx >= 0 && idx + 1 < all.length ? all[idx + 1].id : null;
      var nextAny = levels()[lv.n] ? levels()[lv.n].id : null;   // 下一個世界尚未開放時，仍記下一關編號
      setF(SHEETS.STUDENTS, s._r, 'Gold', total);
      setF(SHEETS.STUDENTS, s._r, 'Cleared_Stars_JSON', JSON.stringify(stars));
      if (isFirst && cur && cur.id === lv.id && (next || nextAny)) setF(SHEETS.STUDENTS, s._r, 'Current_Level', next || nextAny);
      setF(SHEETS.STUDENTS, s._r, 'Current_Fail_Count', 0);
      if (hintUsed) { delete hints[lv.id]; setF(SHEETS.STUDENTS, s._r, 'Hints_JSON', JSON.stringify(hints)); }
      setF(SHEETS.STUDENTS, s._r, 'Last_Active_Time', env.nowIso());
      var work = JSON.stringify(works); if (work.length > 45000) work = work.slice(0, 45000);
      db.append(SHEETS.LOGS, [env.uuid(), env.nowIso(), String(s.Student_ID), String(s.Class_ID), String(s.Name), lv.id, got, gold, isFirst, steps, Math.round(acc * 1000) / 1000, fails, work]);
      var rank = rankOf(stars, levels());
      if (lv.boss && isFirst) addFeed(String(s.Class_ID), 'BOSS', '🎉 ' + s.Name + ' 吹散了毒霧魔王，晉升為「' + RANKS[rank] + '」！');
      else if (got === 3 && (isFirst || isUp)) addFeed(String(s.Class_ID), 'STAR', '🌟 ' + s.Name + ' 以 ' + steps + ' 步完美三星完成【' + lv.title + '】');
      cache.del('PA_PROG_' + s.Class_ID);
      return { status: 'ok', stars: got, bestStars: stars[lv.id], isFirst: isFirst, isUpgrade: isUp, goldEarned: gold, totalGold: total, nextLevelId: isFirst ? (next || nextAny) : null, clearedStars: stars, rank: rank, hintUsed: hintUsed };
    });
  };

  /* ---- 教師端 API ---- */
  function adminOk(tok) {
    if (!tok) return false;
    if (cache.get('PA_ADMIN_' + tok)) return true;
    var ok = table(SHEETS.ADMIN).some(function (a) { return String(a.Admin_Token) === String(tok); });
    if (ok) cache.put('PA_ADMIN_' + tok, '1', 3600);
    return ok;
  }
  function denied() { return { status: 'error', message: '老師登入已過期，請重新登入。', relogin: true }; }
  H.teacherLogin = function (req) {
    var a = table(SHEETS.ADMIN).filter(function (r) { return String(r.Admin_User).trim() === String(req.user || '').trim(); })[0];
    if (!a || String(a.Admin_Pass).trim() !== String(req.password || '').trim()) return { status: 'error', message: '帳號或密碼錯誤。' };
    var tok = env.uuid(); setF(SHEETS.ADMIN, a._r, 'Admin_Token', tok); cache.put('PA_ADMIN_' + tok, '1', 3600);
    return { status: 'ok', token: tok, teacherName: String(a.Teacher_Name || '老師'), levels: levels(), worlds: WORLDS, ranks: RANKS };
  };
  H.getTeacherDashboard = function (req) {
    if (!adminOk(req.token)) return denied();
    var c = classes();
    var students = table(SHEETS.STUDENTS).map(function (s) {
      var o = studentOut(s); o.password = String(s.Password); o.lastActive = String(s.Last_Active_Time || ''); return o;
    });
    var allFeed = table(SHEETS.FEED).slice(-30).reverse().map(function (f) { var cid = String(f.Class_ID); return { time: String(f.Event_Time), type: String(f.Type), message: (cid === 'ALL' ? '' : '［' + ((c[cid] && c[cid].name) || cid) + '］') + String(f.Message) }; });
    return { status: 'ok', classes: Object.keys(c).sort().map(function (k) { return c[k]; }), students: students, levels: levels().map(function (l) { return { id: l.id, world: l.world, title: l.title, boss: l.boss, star3: l.star3 }; }), feed: allFeed, now: env.nowIso() };
  };
  H.updateClassControl = function (req) {
    if (!adminOk(req.token)) return denied();
    var k = req.cls || {}, id = String(k.classId || '').trim();
    if (!/^[A-Za-z0-9_-]{1,12}$/.test(id)) return { status: 'error', message: '班級代號只能用英文或數字（例：601）。' };
    return env.lock(function () {
      var row = [id, String(k.name || id), String(k.status || 'OPEN').toUpperCase(), hm(k.start, '00:00'), hm(k.end, '23:59'), maxLevelOf(k.maxLevel), String(k.broadcast || ''), env.nowIso()];
      var ex = table(SHEETS.CLASSES).filter(function (c) { return String(c.Class_ID).trim() === id; })[0];
      if (ex) { if (req.create) return { status: 'error', message: '班級 ' + id + ' 已經存在。' }; db.setRow(SHEETS.CLASSES, ex._r, row); }
      else db.append(SHEETS.CLASSES, row);
      cache.del('PA_CLASSES');
      if (k.broadcast && (!ex || String(ex.Teacher_Broadcast) !== String(k.broadcast))) addFeed(id, 'TEACHER', '📢 老師：' + k.broadcast);
      return { status: 'ok' };
    });
  };
  H.manageStudents = function (req) {
    if (!adminOk(req.token)) return denied();
    return env.lock(function () {
      var op = req.op, list = table(SHEETS.STUDENTS);
      var byId = function (id) { return list.filter(function (s) { return String(s.Student_ID) === String(id); })[0]; };
      if (op === 'add') {
        var cls = String(req.classId || '').trim(); if (!classes()[cls]) return { status: 'error', message: '請先建立班級 ' + cls + '。' };
        var added = 0, updated = 0;
        (req.list || []).forEach(function (it) {
          var seat = pad2(it.seat), name = String(it.name || '').trim(), pw = String(it.password || '').trim() || '1234';
          if (!seat || !name) return;
          var ex = list.filter(function (s) { return String(s.Class_ID) === cls && pad2(s.Seat_No) === seat; })[0];
          if (ex) { setF(SHEETS.STUDENTS, ex._r, 'Name', name); setF(SHEETS.STUDENTS, ex._r, 'Password', pw); updated++; }
          else { db.append(SHEETS.STUDENTS, [cls + '_' + seat, cls, seat, name, pw, '', ECON.START_GOLD, 'W1-01', 0, '{}', JSON.stringify(DEFAULT_LOOK), '{}', '', '[]', '{}', '{}']); added++; }
        });
        cache.del('PA_PROG_' + cls);
        return { status: 'ok', message: '新增 ' + added + ' 位、更新 ' + updated + ' 位。' };
      }
      if (op === 'import') {
        // Excel 名冊匯入：班級不存在就自動建立；密碼空白時，舊學生保留原密碼、新學生由前端先產生好
        var clsMap = classes(), newCls = [], add2 = 0, upd2 = 0, skip = [], out = [];
        (req.list || []).forEach(function (it, i) {
          var cid = String(it.classId || '').trim(), seat = pad2(it.seat), name = String(it.name || '').trim(), pw = String(it.password || '').trim();
          if (!cid || !seat || !name) { skip.push('第 ' + (it.row || i + 2) + ' 列：班級、座號或姓名空白'); return; }
          if (!/^[A-Za-z0-9_-]{1,12}$/.test(cid)) { skip.push('第 ' + (it.row || i + 2) + ' 列：班級代號「' + cid + '」只能用英文或數字'); return; }
          if (!/^\d{1,2}$/.test(seat)) { skip.push('第 ' + (it.row || i + 2) + ' 列：座號「' + seat + '」要是 1～99 的數字'); return; }
          if (!clsMap[cid]) {
            db.append(SHEETS.CLASSES, [cid, String(it.className || '').trim() || cid, 'OPEN', '00:00', '23:59', maxLevelOf(999), '', env.nowIso()]);
            clsMap[cid] = { classId: cid }; newCls.push(cid); cache.del('PA_CLASSES');
          }
          var ex = list.filter(function (x) { return String(x.Class_ID).trim() === cid && pad2(x.Seat_No) === seat; })[0];
          if (ex) {
            setF(SHEETS.STUDENTS, ex._r, 'Name', name);
            if (pw && (req.overwrite || !String(ex.Password).trim())) setF(SHEETS.STUDENTS, ex._r, 'Password', pw); else pw = String(ex.Password);
            upd2++;
          } else {
            if (!pw) pw = '1234';
            var row = [cid + '_' + seat, cid, seat, name, pw, '', ECON.START_GOLD, 'W1-01', 0, '{}', JSON.stringify(DEFAULT_LOOK), '{}', '', '[]', '{}', '{}'];
            db.append(SHEETS.STUDENTS, row); list.push({ Student_ID: row[0], Class_ID: cid, Seat_No: seat, Name: name, Password: pw }); add2++;
          }
          out.push({ classId: cid, seat: seat, name: name, password: pw });
          cache.del('PA_PROG_' + cid);
        });
        return { status: 'ok', added: add2, updated: upd2, newClasses: newCls, skipped: skip, list: out,
          message: (newCls.length ? '建立班級 ' + newCls.join('、') + '；' : '') + '新增 ' + add2 + ' 位、更新 ' + upd2 + ' 位' + (skip.length ? '；略過 ' + skip.length + ' 列' : '') + '。' };
      }
      if (op === 'setPasswords') {
        // 全班（或多位）一次改密碼：list = [{ studentId, password }]
        var n = 0;
        (req.list || []).forEach(function (it) { var x = byId(it.studentId), pw = String(it.password || '').trim(); if (x && pw) { setF(SHEETS.STUDENTS, x._r, 'Password', pw); n++; } });
        return { status: 'ok', message: '已更新 ' + n + ' 位學生的密碼。' };
      }
      var s = byId(req.studentId); if (!s) return { status: 'error', message: '找不到這位學生。' };
      if (op === 'password') { var np = String(req.password || '').trim(); if (!/^[A-Za-z0-9]{3,12}$/.test(np)) return { status: 'error', message: '密碼要 3～12 個英文字母或數字。' }; setF(SHEETS.STUDENTS, s._r, 'Password', np); return { status: 'ok', message: s.Name + ' 的密碼已改成 ' + np + '。' }; }
      if (op === 'rename') { setF(SHEETS.STUDENTS, s._r, 'Name', String(req.name || s.Name)); return { status: 'ok', message: '姓名已更新。' }; }
      if (op === 'kick') { setF(SHEETS.STUDENTS, s._r, 'Session_Token', ''); cache.del('PA_TOKEN_' + s.Student_ID); return { status: 'ok', message: '已讓這位學生登出。' }; }
      if (op === 'resetProgress') {
        setF(SHEETS.STUDENTS, s._r, 'Gold', ECON.START_GOLD); setF(SHEETS.STUDENTS, s._r, 'Current_Level', 'W1-01'); setF(SHEETS.STUDENTS, s._r, 'Current_Fail_Count', 0);
        setF(SHEETS.STUDENTS, s._r, 'Cleared_Stars_JSON', '{}'); setF(SHEETS.STUDENTS, s._r, 'Hints_JSON', '{}');
        setF(SHEETS.STUDENTS, s._r, 'Owned_JSON', '[]'); setF(SHEETS.STUDENTS, s._r, 'Badges_JSON', '{}'); setF(SHEETS.STUDENTS, s._r, 'Pets_JSON', '{}'); setF(SHEETS.STUDENTS, s._r, 'Look_JSON', JSON.stringify(normalizeLook(pj(s.Look_JSON, {}), [])));
        cache.del('PA_PROG_' + s.Class_ID); return { status: 'ok', message: '進度已重設。' };
      }
      if (op === 'delete') { db.del(SHEETS.STUDENTS, s._r); cache.del('PA_PROG_' + s.Class_ID); return { status: 'ok', message: '已刪除。' }; }
      return { status: 'error', message: '未知的操作。' };
    });
  };
  H.inspectStudent = function (req) {
    if (!adminOk(req.token)) return denied();
    var logs = table(SHEETS.LOGS).filter(function (l) { return String(l.Student_ID) === String(req.studentId); });
    var latest = {}, tries = {};
    logs.forEach(function (l) {
      var id = String(l.Level_ID); tries[id] = (tries[id] || 0) + 1;
      latest[id] = { time: String(l.Timestamp), stars: Number(l.Stars), steps: Number(l.Steps), accuracy: Number(l.Accuracy), fails: Number(l.Fails), works: pj(l.Work_JSON, []) };
    });
    return { status: 'ok', works: latest, clears: tries };
  };

  return function handle(req) {
    req = req || {};
    var f = H[req.action];
    if (!f) return { status: 'error', message: '未知的動作：' + req.action };
    try { return f(req); } catch (e) { return { status: 'error', message: '伺服器錯誤：' + (e && e.message ? e.message : e) }; }
  };
}

/* ============================================================================
 * 拒毒萌芽小畫家｜Google Apps Script 接頭（把共用後端邏輯接到 Google 試算表）
 * ========================================================================== */
var __SS = null;
function getSS() {
  if (__SS) return __SS;
  var ss = null;
  try { ss = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) { ss = null; }
  if (!ss) {
    var props = PropertiesService.getScriptProperties(), id = props.getProperty('SPREADSHEET_ID');
    if (id) { try { ss = SpreadsheetApp.openById(id); } catch (e) { ss = null; } }
    if (!ss) {
      ss = SpreadsheetApp.create('拒毒萌芽小畫家_雲端資料庫');
      try { ss.setSpreadsheetTimeZone('Asia/Taipei'); } catch (e) {}
      props.setProperty('SPREADSHEET_ID', ss.getId());
    }
  }
  __SS = ss; return ss;
}

/** 試算表資料層：同一個請求內快取讀到的資料，寫入時同步更新 */
function makeSheetDB() {
  var ss = getSS(), mem = {};
  function sh(name) { return ss.getSheetByName(name); }
  return {
    rows: function (name) {
      if (!mem[name]) { var s = sh(name); mem[name] = s ? s.getDataRange().getValues() : [HEADERS[name]]; }
      return mem[name];
    },
    set: function (name, r, c, v) { sh(name).getRange(r + 1, c + 1).setValue(v); var m = this.rows(name); if (m[r]) m[r][c] = v; },
    setRow: function (name, r, arr) { sh(name).getRange(r + 1, 1, 1, arr.length).setValues([arr]); var m = this.rows(name); m[r] = arr.slice(); },
    append: function (name, arr) { sh(name).appendRow(arr); if (mem[name]) mem[name].push(arr.slice()); },
    del: function (name, r) { sh(name).deleteRow(r + 1); if (mem[name]) mem[name].splice(r, 1); }
  };
}
function makeEnv() {
  var c = CacheService.getScriptCache();
  return {
    db: makeSheetDB(),
    cache: { get: function (k) { return c.get(k); }, put: function (k, v, s) { c.put(k, v, s); }, del: function (k) { c.remove(k); } },
    lock: function (fn) { var l = LockService.getScriptLock(); l.waitLock(15000); try { return fn(); } finally { l.releaseLock(); } },
    // 自訂題庫：存在指令碼屬性（每個屬性有大小上限，所以切成小段）
    kv: {
      get: function (k) { var p = PropertiesService.getScriptProperties().getProperties(), n = Number(p[k + '_n'] || 0), out = ''; for (var i = 0; i < n; i++) out += p[k + '_' + i] || ''; return out; },
      set: function (k, v) {
        var ps = PropertiesService.getScriptProperties(), old = Number(ps.getProperty(k + '_n') || 0), o = {}, n = Math.ceil(v.length / 2500);
        for (var i = 0; i < n; i++) o[k + '_' + i] = v.substr(i * 2500, 2500);
        o[k + '_n'] = String(n); ps.setProperties(o);
        for (var j = n; j < old; j++) ps.deleteProperty(k + '_' + j);
      }
    },
    uuid: function () { return Utilities.getUuid(); },
    nowIso: function () { return new Date().toISOString(); },
    nowHM: function () { return Utilities.formatDate(new Date(), 'Asia/Taipei', 'HH:mm'); }
  };
}

function getOrCreateSheet(ss, name) {
  var s = ss.getSheetByName(name);
  if (!s) s = ss.insertSheet(name);
  if (s.getLastRow() === 0) {
    s.appendRow(HEADERS[name]);
    s.getRange(1, 1, 1, HEADERS[name].length).setFontWeight('bold').setBackground('#f3e3c3');
    s.setFrozenRows(1);
  }
  return s;
}

/** ▶ 第一次使用：在 Apps Script 上方選 setupDatabase 再按「執行」 */
function setupDatabase() {
  var ss = getSS(), now = new Date().toISOString(), seed = demoSeedRows(now);
  Object.keys(SHEETS).forEach(function (k) { getOrCreateSheet(ss, SHEETS[k]); });
  // 代號、座號、密碼、時間都用「純文字」格式，避免 01 變成 1、08:00 變成時間
  ss.getSheetByName(SHEETS.CLASSES).getRange('A:A').setNumberFormat('@');
  ss.getSheetByName(SHEETS.CLASSES).getRange('D:E').setNumberFormat('@');
  ss.getSheetByName(SHEETS.STUDENTS).getRange('A:C').setNumberFormat('@');
  ss.getSheetByName(SHEETS.STUDENTS).getRange('E:E').setNumberFormat('@');
  ['Classes', 'Students', 'Live_Feed', 'Admin'].forEach(function (name) {
    var s = ss.getSheetByName(name);
    if (s.getLastRow() === 1 && seed[name]) s.getRange(2, 1, seed[name].length, seed[name][0].length).setValues(seed[name]);
  });
  seedLevels();
  try { CacheService.getScriptCache().removeAll(['PA_CLASSES', 'PA_LEVELS_' + LEVELS_VERSION, 'PA_DB_READY']); } catch (e) {}
  Logger.log('✅ 拒毒萌芽小畫家資料庫建立完成：' + ss.getUrl());
}
/** 把程式裡的關卡寫進 Levels 工作表（更新 Code.gs 後會自動執行一次） */
function seedLevels() {
  var ss = getSS(), s = getOrCreateSheet(ss, SHEETS.LEVELS);
  if (s.getLastRow() > 1) s.getRange(2, 1, s.getLastRow() - 1, s.getLastColumn()).clearContent();
  var rows = levelsToRows();
  s.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
  s.getRange('A:A').setNumberFormat('@');
  PropertiesService.getScriptProperties().setProperty('LEVELS_VERSION', LEVELS_VERSION);
}
/** 舊版試算表少了新欄位（例如 Owned_JSON）時，自動補在標題列最右邊 */
function ensureHeaders(ss) {
  Object.keys(SHEETS).forEach(function (k) {
    var name = SHEETS[k], s = ss.getSheetByName(name), want = HEADERS[name]; if (!s || s.getLastRow() === 0) return;
    var have = s.getRange(1, 1, 1, Math.max(1, s.getLastColumn())).getValues()[0].map(String);
    want.forEach(function (h, i) { if (have.indexOf(h) < 0 && i >= have.length) { s.getRange(1, i + 1).setValue(h).setFontWeight('bold').setBackground('#f3e3c3'); have[i] = h; } });
  });
}
function ensureDatabase() {
  var c = CacheService.getScriptCache(), ready = LEVELS_VERSION + '|' + SCHEMA_VERSION;
  if (c.get('PA_DB_READY') === ready) return;
  var ss = getSS();
  var missing = Object.keys(SHEETS).some(function (k) { return !ss.getSheetByName(SHEETS[k]); });
  if (missing) setupDatabase();
  else {
    ensureHeaders(ss);
    if (PropertiesService.getScriptProperties().getProperty('LEVELS_VERSION') !== LEVELS_VERSION) seedLevels();
  }
  c.put('PA_DB_READY', ready, 600);
}

function jsonOut(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function runApi(req) {
  ensureDatabase();
  var handle = makeServer(makeEnv());
  var res = handle(req);
  if (req.action === 'ping') { var ss = getSS(); res.spreadsheet = ss.getName(); res.spreadsheetUrl = ss.getUrl(); }
  return res;
}
function doGet(e) {
  var p = (e && e.parameter) || {};
  if (!p.action) return HtmlService.createHtmlOutput('<meta charset="utf-8"><p style="font-family:sans-serif">拒毒萌芽小畫家雲端後端運作中。請到 GitHub Pages 的網址開啟遊戲。檢查狀態：在網址後面加上 ?action=ping</p>');
  if (p.action !== 'ping' && p.action !== 'getClassList') return jsonOut({ status: 'error', message: '請使用 POST' });
  return jsonOut(runApi({ action: p.action }));
}
function doPost(e) {
  var req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return jsonOut({ status: 'error', message: '無效的請求格式' }); }
  return jsonOut(runApi(req));
}
