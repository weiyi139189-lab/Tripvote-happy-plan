let members = [];

const avatarEmojis = {
  "avatar-a": "😎",
  "avatar-b": "🤗",
  "avatar-c": "🦊",
  "avatar-d": "🐱",
  "avatar-e": "🐼",
  "avatar-f": "🦁",
  "avatar-g": "🐸",
  "avatar-h": "🦉",
  "avatar-i": "🐯",
  "avatar-j": "🐧",
};

let currentMemberId = localStorage.getItem("tripvote-member-id");
let apiMode = null;
const LOCAL_STORAGE_KEY = "tripvote-local-state";

function readLocalState() {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return { members: [], votes: {}, customDestinations: [], comments: {} };
    const state = JSON.parse(raw);
    state.members = state.members || [];
    state.votes = state.votes || {};
    state.customDestinations = state.customDestinations || [];
    state.comments = state.comments || {};
    return state;
  } catch {
    return { members: [], votes: {}, customDestinations: [], comments: {} };
  }
}

function writeLocalState(state) {
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(state));
}

function localApi(path, options = {}) {
  const action = path.replace(/^\/api\//, "");
  const body = options.body ? JSON.parse(options.body) : {};
  const state = readLocalState();

  if (action === "health") return { ok: true };
  if (action === "state") return { members: state.members, votes: state.votes, customDestinations: state.customDestinations, comments: state.comments };

  if (action === "member") {
    const name = String(body.name || "").trim();
    const className = String(body.className || "avatar-a").trim() || "avatar-a";
    if (!name) throw new Error("name required");
    const member = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      className,
      joinedAt: Math.floor(Date.now() / 1000),
    };
    state.members.push(member);
    writeLocalState(state);
    return { members: state.members, votes: state.votes, customDestinations: state.customDestinations, comments: state.comments, currentMemberId: member.id };
  }

  if (action === "vote") {
    const { memberId, destinationId, voteType } = body;
    if (!["heart", "veto"].includes(voteType) || !memberId || !destinationId) throw new Error("invalid vote");
    const votes = state.votes[destinationId] || { heart: [], veto: [] };
    votes.heart = (votes.heart || []).filter((id) => id !== memberId);
    votes.veto = (votes.veto || []).filter((id) => id !== memberId);
    if (!votes[voteType]?.includes?.(memberId) || !(votes.heart.includes(memberId) || votes.veto.includes(memberId))) {
      votes[voteType] = votes[voteType] || [];
      if (!votes[voteType].includes(memberId)) votes[voteType].push(memberId);
    }
    state.votes[destinationId] = votes;
    writeLocalState(state);
    return { members: state.members, votes: state.votes, customDestinations: state.customDestinations, comments: state.comments };
  }

  if (action === "destination") {
    const { memberId, destination } = body;
    const destinationId = String(destination?.id || "");
    if (!memberId || !destinationId) throw new Error("invalid destination");
    state.customDestinations = state.customDestinations.filter((d) => d.id !== destinationId);
    state.customDestinations.unshift(destination);
    state.votes[destinationId] = destination.votes || { heart: [memberId], veto: [] };
    writeLocalState(state);
    return { members: state.members, votes: state.votes, customDestinations: state.customDestinations, comments: state.comments };
  }

  if (action === "comment") {
    const { destinationId, memberId, text } = body;
    if (!destinationId || !memberId || !String(text || "").trim()) throw new Error("invalid comment");
    const member = state.members.find((m) => m.id === memberId);
    if (!state.comments[destinationId]) state.comments[destinationId] = [];
    const comment = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      memberId,
      memberName: member?.name || "匿名",
      memberClass: member?.className || "avatar-a",
      text: String(text).trim(),
      createdAt: Math.floor(Date.now() / 1000),
    };
    state.comments[destinationId].push(comment);
    writeLocalState(state);
    return { members: state.members, votes: state.votes, customDestinations: state.customDestinations, comments: state.comments };
  }

  throw new Error(`unknown local action: ${action}`);
}

// ---------- Firebase Realtime Database API ----------
const _fbDb = window.__firebaseReady && typeof firebase !== "undefined" ? firebase.database() : null;

function _fbObjectToArray(obj) {
  if (!obj || typeof obj !== "object") return [];
  return Object.values(obj);
}

function _fbMergeState(snapshot) {
  const data = snapshot.val() || {};
  return {
    members: _fbObjectToArray(data.members),
    votes: data.votes || {},
    customDestinations: _fbObjectToArray(data.customDestinations),
    comments: {},
    _rawComments: data.comments || {},
  };
}

function _fbFinalizeState(data) {
  const comments = {};
  for (const [destId, commentsObj] of Object.entries(data._rawComments || {})) {
    comments[destId] = _fbObjectToArray(commentsObj);
  }
  data.comments = comments;
  delete data._rawComments;
  return {
    members: data.members,
    votes: data.votes,
    customDestinations: data.customDestinations,
    comments: data.comments,
  };
}

async function firebaseApi(path, options = {}) {
  const action = path.replace(/^\/api\//, "");
  const body = options.body ? JSON.parse(options.body) : {};

  if (action === "health") return { ok: true };

  if (action === "state") {
    const snapshot = await _fbDb.ref("/").once("value");
    return _fbFinalizeState(_fbMergeState(snapshot));
  }

  if (action === "member") {
    const name = String(body.name || "").trim();
    const className = String(body.className || "avatar-a").trim() || "avatar-a";
    if (!name) throw new Error("name required");
    const member = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      className,
      joinedAt: Math.floor(Date.now() / 1000),
      clientJoinId: body.clientJoinId || null,
    };
    await _fbDb.ref(`/members/${member.id}`).set(member);
    const snapshot = await _fbDb.ref("/").once("value");
    const result = _fbFinalizeState(_fbMergeState(snapshot));
    result.currentMemberId = member.id;
    return result;
  }

  if (action === "vote") {
    const { memberId, destinationId, voteType } = body;
    if (!["heart", "veto"].includes(voteType) || !memberId || !destinationId) throw new Error("invalid vote");
    const voteRef = _fbDb.ref(`/votes/${destinationId}`);
    const voteSnap = await voteRef.once("value");
    const votes = voteSnap.val() || { heart: [], veto: [] };
    votes.heart = (votes.heart || []).filter((id) => id !== memberId);
    votes.veto = (votes.veto || []).filter((id) => id !== memberId);
    if (!votes[voteType].includes(memberId)) votes[voteType].push(memberId);
    await voteRef.set(votes);
    const snapshot = await _fbDb.ref("/").once("value");
    return _fbFinalizeState(_fbMergeState(snapshot));
  }

  if (action === "destination") {
    const { memberId, destination } = body;
    const destinationId = String(destination?.id || "");
    if (!memberId || !destinationId) throw new Error("invalid destination");
    await _fbDb.ref(`/customDestinations/${destinationId}`).set(destination);
    await _fbDb.ref(`/votes/${destinationId}`).set(destination.votes || { heart: [memberId], veto: [] });
    const snapshot = await _fbDb.ref("/").once("value");
    return _fbFinalizeState(_fbMergeState(snapshot));
  }

  if (action === "comment") {
    const { destinationId, memberId, text } = body;
    if (!destinationId || !memberId || !String(text || "").trim()) throw new Error("invalid comment");
    const member = members.find((m) => m.id === memberId);
    const comment = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      memberId,
      memberName: member?.name || "匿名",
      memberClass: member?.className || "avatar-a",
      text: String(text).trim(),
      createdAt: Math.floor(Date.now() / 1000),
    };
    await _fbDb.ref(`/comments/${destinationId}/${comment.id}`).set(comment);
    const snapshot = await _fbDb.ref("/").once("value");
    return _fbFinalizeState(_fbMergeState(snapshot));
  }

  throw new Error(`unknown firebase action: ${action}`);
}

// ---------- Firebase real-time listener ----------
let _fbListenerActive = false;

function startFirebaseListener() {
  if (!_fbDb || _fbListenerActive) return;
  _fbListenerActive = true;
  _fbDb.ref("/").on("value", (snapshot) => {
    const state = _fbFinalizeState(_fbMergeState(snapshot));
    applySharedState(state);
    if (screens.workspace.classList.contains("active")) {
      renderWorkspace();
    }
  });
}

let project = {
  title: "福赛斯元旦5天 Happy 计划",
  travelStartDate: "2027-01-01",
};

const travelDays = ["01.01", "01.02", "01.03", "01.04", "01.05"];
const palettes = [
  "linear-gradient(135deg, #70d6ff, #0b638c 54%, #f6d56f)",
  "linear-gradient(135deg, #b8f1ed, #3a95bd 48%, #ffb88c)",
  "linear-gradient(135deg, #f5b64d, #d7526f 48%, #3d2b7c)",
  "linear-gradient(135deg, #87d6c6, #166b73 52%, #f2a66d)",
  "linear-gradient(135deg, #d8f0df, #63b78a 48%, #f1ca72)",
  "linear-gradient(135deg, #e5c8ff, #5b4a9f 48%, #56c5d0)",
  "linear-gradient(135deg, #ffe0a8, #b66b3a 50%, #38536b)",
  "linear-gradient(135deg, #b8d9ff, #486aa8 52%, #f7c873)",
];

const categoryGroups = [
  {
    id: "tropical",
    title: "🏆 阵营一：热带海岛流",
    subtitle: "少爷公主式的顶级躺平",
    ids: ["phuket", "danang", "jeju", "okinawa", "kota-kinabalu", "bali", "sri-lanka", "ha-long-bay"],
  },
  {
    id: "snow",
    title: "❄️ 阵营二：粉雪冬日流",
    subtitle: "围炉煮茶与冰火交融",
    ids: ["harbin", "sapporo", "altay"],
  },
  {
    id: "civilization",
    title: "🛕 阵营三：小众文明流",
    subtitle: "寺庙古城与精神出走",
    ids: ["luang-prabang", "kathmandu", "ulaanbaatar"],
  },
  {
    id: "domestic",
    title: "🌿 阵营四：国内松弛流",
    subtitle: "低手续、高参与、吃住稳",
    ids: ["jiangxi", "guangxi", "nanning-fangchenggang"],
  },
  {
    id: "city-food",
    title: "🍜 阵营五：都市美食流",
    subtitle: "按摩夜市与咖啡续命",
    ids: ["hanoi-ho-chi-minh", "bangkok"],
  },
  {
    id: "custom",
    title: "✨ 阵营六：成员私藏流",
    subtitle: "临时追加的新灵感",
    ids: [],
  },
];

const categoryByDestinationId = categoryGroups.reduce((index, group) => {
  group.ids.forEach((id) => {
    index[id] = group.id;
  });
  return index;
}, {});

const flightInfo = {
  phuket: "直飞约 5.5 小时；转机通常 7-9 小时",
  danang: "直飞约 4.5 小时；转机通常 6-8 小时",
  jeju: "直飞约 1.5-2 小时；包车移动更省心",
  okinawa: "直飞那霸约 2-2.5 小时；落地建议租车",
  "kota-kinabalu": "直飞约 4.5 小时；转机通常 7-9 小时",
  harbin: "直飞约 3 小时；高铁时间较长",
  bali: "直飞/包机约 6.5 小时；常规转机多为 9-12 小时",
  "luang-prabang": "通常需转机，总耗时约 7-10 小时",
  kathmandu: "通常需转机，总耗时约 8-12 小时",
  "sri-lanka": "飞科伦坡直飞约 7 小时；转机约 9-12 小时",
  ulaanbaatar: "通常经北京/首尔转机，总耗时约 6-9 小时",
  altay: "通常经乌鲁木齐中转，总耗时约 6-9 小时",
  sapporo: "直飞/转机约 4-7 小时，元旦票价需提前锁",
  jiangxi: "飞南昌约 1.5 小时；高铁到景德镇/南昌约 3-5 小时",
  guangxi: "飞桂林/南宁约 3 小时；高铁约 8-11 小时",
  "nanning-fangchenggang": "飞南宁约 3 小时，再高铁/包车约 1-1.5 小时",
  "hanoi-ho-chi-minh": "飞河内约 4 小时，飞胡志明约 4.5 小时",
  bangkok: "直飞约 4.5 小时；航班密度高",
  "ha-long-bay": "先飞河内约 4 小时，再车程约 2.5-3.5 小时",
};

const coverQueries = {
  phuket: "phuket beach villa",
  danang: "da nang beach vietnam",
  jeju: "jeju island coast",
  okinawa: "okinawa beach japan",
  "kota-kinabalu": "kota kinabalu sunset",
  harbin: "harbin ice city",
  bali: "bali villa pool",
  "luang-prabang": "luang prabang temple",
  kathmandu: "kathmandu nepal square",
  "sri-lanka": "sri lanka beach tea",
  ulaanbaatar: "mongolia grassland",
  altay: "altay xinjiang snow",
  sapporo: "sapporo snow japan",
  jiangxi: "jingdezhen wuyuan jiangxi",
  guangxi: "guangxi yangshuo landscape",
  "nanning-fangchenggang": "fangchenggang beach guangxi",
  "hanoi-ho-chi-minh": "hanoi old quarter vietnam",
  bangkok: "bangkok night market",
  "ha-long-bay": "ha long bay vietnam",
};

const photoUrls = {
  phuket: "https://images.unsplash.com/photo-1589394815804-964ed0e2eb5b?w=600&h=400&fit=crop",
  danang: "https://images.unsplash.com/photo-1559592413-7cec4d0cae2b?w=600&h=400&fit=crop",
  jeju: "https://images.unsplash.com/photo-1578752237507-28d47b81e0a7?w=600&h=400&fit=crop",
  okinawa: "https://images.unsplash.com/photo-1573551089778-46a7abc39d9b?w=600&h=400&fit=crop",
  "kota-kinabalu": "https://images.unsplash.com/photo-1580713364819-2da71e30e5e0?w=600&h=400&fit=crop",
  harbin: "https://images.unsplash.com/photo-1551918120-9719aa4a3974?w=600&h=400&fit=crop",
  bali: "https://images.unsplash.com/photo-1537996194471-e657df975ab4?w=600&h=400&fit=crop",
  "luang-prabang": "https://images.unsplash.com/photo-1583417319070-4a69db38a482?w=600&h=400&fit=crop",
  kathmandu: "https://images.unsplash.com/photo-1558862234-5ee7a4f4a0c9?w=600&h=400&fit=crop",
  "sri-lanka": "https://images.unsplash.com/photo-1586523969823-ba44e7e46e1c?w=600&h=400&fit=crop",
  ulaanbaatar: "https://images.unsplash.com/photo-1577748999869-52a0736b9575?w=600&h=400&fit=crop",
  altay: "https://images.unsplash.com/photo-1508804185872-d7badad00f7d?w=600&h=400&fit=crop",
  sapporo: "https://images.unsplash.com/photo-1578637387939-43c525550085?w=600&h=400&fit=crop",
  jiangxi: "https://images.unsplash.com/photo-1528164344705-47542687000d?w=600&h=400&fit=crop",
  guangxi: "https://images.unsplash.com/photo-1529921879218-f99546d05220?w=600&h=400&fit=crop",
  "nanning-fangchenggang": "https://images.unsplash.com/photo-1537531383496-f4749b57aae6?w=600&h=400&fit=crop",
  "hanoi-ho-chi-minh": "https://images.unsplash.com/photo-1583417319070-4a69db38a482?w=600&h=400&fit=crop",
  bangkok: "https://images.unsplash.com/photo-1508009603885-50cf7c579365?w=600&h=400&fit=crop",
  "ha-long-bay": "https://images.unsplash.com/photo-1528127269322-539801943592?w=600&h=400&fit=crop",
};

const analysisByDestination = {
  phuket:
    "普吉是最稳的“少爷公主躺平”选项，适合大家想住大 villa、白天海边跳岛、晚上按摩吃海鲜的团队。它的优势是成熟、选择多、容错高，哪怕成员喜好不同，也可以自由分组行动。风险是商业化和游客密度高，元旦期间住宿、包车和热门餐厅会明显涨价。",
  danang:
    "岘港是性价比和空间感很强的海岛选择，尤其适合团队住海边大 house。它比普吉更松弛，也比纯城市目的地更有度假感。局限是目的地高级感不如冲绳/巴厘岛，巴拿山和会安都需要花路程，所以行程要克制。",
  jeju:
    "济州岛的优势是免签海岛、拍照好看、黑猪肉和海岸线辨识度强。它适合想要海岛感、但不想处理日本签证的人。最大问题是交通，公共交通不方便，团队最好包车或分车行动；它不是热闹型目的地，更适合慢游和海边聚餐。",
  okinawa:
    "冲绳是更精致、更日式、更舒服的海岛方案，适合团队对住宿、餐饮、整洁度和体验品质有要求。核心爽点是海边 house、自驾、公路海景、和牛、居酒屋和水族馆。风险是日本签证、自驾分工、元旦住宿价格。",
  "kota-kinabalu":
    "亚庇是低压型海岛，不如普吉热闹，也不如冲绳精致，但胜在日落、海鲜、跳岛和节奏轻。适合想轻松看海、吃海鲜、不要复杂安排的团队。风险是城市体量小，5 天需要加入红树林、神山或跳岛来撑内容。",
  harbin:
    "哈尔滨非常适合元旦氛围，冰雪、俄式建筑、东北菜和夜市都适合团队一起热闹。优势是国内出行、组织简单、聚餐快乐；风险是冷、热门景点人多，住宿不一定有大 house 氛围。它适合想要冬季仪式感的团队。",
  bali:
    "巴厘岛是 villa 体验最强的选项，适合把住宿本身当成旅行核心。它很适合团队拍照、泳池、brunch、SPA、海边日落和仪式感。问题是飞行和岛内交通都更消耗时间，5 天可以做，但不适合排太满。",
  "luang-prabang":
    "琅勃拉邦是安静、小众、松弛的目的地，适合想逃离城市的人。它的核心不是热闹，而是古城、寺庙、湄公河、咖啡和慢节奏。风险是航班衔接、夜生活弱，部分成员可能觉得不够嗨。",
  kathmandu:
    "加德满都非常有冲击力，适合想要非典型旅行的人。优势是文化、古城、雪山视野和强烈异域感；风险是城市基础设施、卫生、交通和舒适度。这个目的地需要团队提前统一心理预期。",
  "sri-lanka":
    "斯里兰卡内容很丰富，海岸、茶园、古城、野生动物都有，但 5 天不能贪心。更适合做一条轻量海岸线，而不是完整环岛。优势是差异化强、记忆点高；风险是点位分散、路程长、舒适度不如成熟海岛。",
  ulaanbaatar:
    "乌兰巴托和蒙古草原适合做一次非常不一样的团队体验：草原、蒙古包、骑马、羊肉和开阔感。优势是记忆点强，适合集体活动；风险是舒适度、车程、天气和餐饮单一。适合想出去野一下的团队。",
  altay:
    "阿勒泰是国内自然大片型选择，雪景、草原、公路、北疆氛围都很强。优势是风景震撼，适合喜欢户外和拍照的人；风险是车程、天气、住宿条件和交通衔接。它适合冒险精神更强的团队。",
  sapporo:
    "札幌是更精致的冬日方案，海鲜、拉面、温泉、小樽、雪景都很稳。它比哈尔滨更舒服，但签证和预算门槛更高。适合大家想要“冰雪 + 美食 + 日式舒适”的版本，元旦机酒要提前锁定。",
  jiangxi:
    "江西适合做文化和山水结合的国内方案，比如景德镇、婺源、庐山选一条主线。优势是国内手续简单，陶瓷、村落、山水都有内容；风险是路线容易贪多。适合不想出境，但又想有内容深度的团队。",
  guangxi:
    "广西是国内山水和海边的折中选择，可以走桂林阳朔，也可以走北海/防城港。优势是国内低门槛、餐饮有特色、选择弹性大；风险是如果同时要山和海，5 天也会变赶。",
  "nanning-fangchenggang":
    "南宁/防城港更偏低压吃喝和海边松弛：南宁负责夜宵和城市补给，防城港负责海边和海鲜。优势是国内手续简单、成本友好；风险是目的地高级感弱，需要靠住宿和吃饭安排补足体验。",
  "hanoi-ho-chi-minh":
    "越南河内/胡志明适合吃喝、咖啡、城市漫游和夜生活。建议河内或胡志明二选一，不要 5 天硬切双城。优势是美食密度高、签证相对友好、自由行动方便；风险是城市交通混乱，度假感不如海岛。",
  bangkok:
    "曼谷是最稳的都市 Happy 方案：吃、按摩、商场、夜市、屋顶 bar 都成熟。它适合成员喜好分散的团队，因为大家可以自由分组。风险是堵车、热门餐厅排队、城市感强。",
  "ha-long-bay":
    "下龙湾适合想要共同体验感的团队，一晚船宿会比普通城市游更有记忆点。它可以和河内组合，形成“城市美食 + 海上巡游”的 5 天方案。风险是船宿品质差异大，天气和晕船会影响体验。",
};

function searchUrl(base, keyword) {
  return `${base}${encodeURIComponent(keyword)}`;
}

const realAirbnbListings = {
  phuket: [
    { name: "Cape Yamu 顶级海景1800平米奢华别墅", url: "https://www.airbnb.com/rooms/1140468303745566050", tag: "团队首选" },
    { name: "Koh Sirey 海滩全海景全包保姆别墅", url: "https://www.airbnb.com/rooms/1658728884910482492", tag: "省心之选" },
    { name: "Bang Tao 海滩现代极简设计私厨独栋", url: "https://www.airbnb.com/rooms/53412574", tag: "出片神器" },
  ],
  danang: [
    { name: "Ocean Villas 度假村内·一线靠海豪宅", url: "https://www.airbnb.com/rooms/787198334724625404", tag: "团队首选" },
    { name: "市区靠山现代桑拿轰趴独栋别墅", url: "https://www.airbnb.com/rooms/1653311505069598095", tag: "省心之选" },
    { name: "Non Nuoc 海滩全落地窗现代全包Villa", url: "https://www.airbnb.com/rooms/42795806", tag: "出片神器" },
  ],
  okinawa: [
    { name: "恩纳村·全海景顶楼露台大型美式别邸", url: "https://www.airbnb.com/rooms/38552104", tag: "团队首选" },
    { name: "名护市·直通私密海滩纯白现代度假屋", url: "https://www.airbnb.com/rooms/49221570", tag: "省心之选" },
    { name: "本部町·近水族馆超大榻榻米日式合家欢", url: "https://www.airbnb.com/rooms/21876543", tag: "出片神器" },
  ],
  jeju: [
    { name: "西归浦·海景超大团建/多房独立别墅", url: "https://www.airbnb.com/rooms/825235751063490448", tag: "团队首选" },
    { name: "涯月邑·高台日落观景包栋现代民宿", url: "https://www.airbnb.com/rooms/66203115", tag: "省心之选" },
    { name: "旧左邑·带室内恒温大泳池家庭聚会Villa", url: "https://www.airbnb.com/rooms/91557023", tag: "出片神器" },
  ],
  "kota-kinabalu": [
    { name: "亚庇市中心 12人+ 豪华多卧室度假屋特辑", url: "https://www.airbnb.com/kota-kinabalu-malaysia/stays/villas", tag: "团队首选" },
    { name: "丹绒亚路（近海滩）大容量全包民宿", url: "https://www.airbnb.com/tanjung-aru-malaysia/stays", tag: "省心之选" },
    { name: "热浪岛/瓜拉登嘉楼大容量海滨住处", url: "https://www.airbnb.com/kuala-terengganu-malaysia/stays", tag: "出片神器" },
  ],
  harbin: [
    { name: "中央大街/防洪纪念塔周边大户型轰趴房源", url: "https://www.airbnb.com/harbin-china/stays", tag: "团队首选" },
    { name: "松北区（近冰雪大世界）独栋别墅包栋", url: "https://www.airbnb.com/harbin-china/stays/villas", tag: "省心之选" },
    { name: "哈尔滨全区适合 12人+ 团队出行", url: "https://www.airbnb.com/harbin-china/stays", tag: "出片神器" },
  ],
  bali: [
    { name: "乌鲁瓦图·180度悬崖海景无边泳池神级Villa", url: "https://www.airbnb.com/rooms/18524104", tag: "团队首选" },
    { name: "乌布·热带雨林溪谷环绕野奢木质大庄园", url: "https://www.airbnb.com/rooms/33452109", tag: "省心之选" },
    { name: "长谷·近冲浪点超大草坪12人顶奢派对别墅", url: "https://www.airbnb.com/rooms/29887165", tag: "出片神器" },
  ],
  sapporo: [
    { name: "二世古·半山奢华带壁炉全景落地窗极美大木屋", url: "https://www.airbnb.com/rooms/42115680", tag: "团队首选" },
    { name: "札幌市区·手稻区近雪场超大现代北欧风包栋", url: "https://www.airbnb.com/rooms/50119842", tag: "省心之选" },
    { name: "小樽海沿线·带私人露天观海泡汤风吕别邸", url: "https://www.airbnb.com/rooms/31224579", tag: "出片神器" },
  ],
  jiangxi: [
    { name: "上饶婺源徽派大型独栋度假屋", url: "https://www.airbnb.com/shangrao-china/stays/villas", tag: "团队首选" },
    { name: "九江庐山风景区大容量避暑避寒山庄包栋", url: "https://www.airbnb.com/jiujiang-china/stays", tag: "省心之选" },
    { name: "南昌市区适合多人聚会的大型轰趴别墅", url: "https://www.airbnb.com/nanchang-china/stays", tag: "出片神器" },
  ],
  guangxi: [
    { name: "桂林阳朔山水间大型精品民宿包栋", url: "https://www.airbnb.com/guilin-china/stays/villas", tag: "团队首选" },
    { name: "桂林市区近两江四湖大容量高评分房源", url: "https://www.airbnb.com/guilin-china/stays", tag: "省心之选" },
    { name: "贺州黄姚古镇大容量古风客栈", url: "https://www.airbnb.com/hezhou-china/stays", tag: "出片神器" },
  ],
  "nanning-fangchenggang": [
    { name: "青秀区（市中心高品质）12人+ 大户型住宅", url: "https://www.airbnb.com/nanning-china/stays", tag: "团队首选" },
    { name: "南宁周边现代独栋轰趴/泳池别墅", url: "https://www.airbnb.com/nanning-china/stays/villas", tag: "省心之选" },
    { name: "西乡塘区/朝阳广场大容量高性价比房源", url: "https://www.airbnb.com/nanning-china/stays", tag: "出片神器" },
  ],
  "hanoi-ho-chi-minh": [
    { name: "河内西湖区法式复古大洋房独栋", url: "https://www.airbnb.com/rooms/35661290", tag: "团队首选" },
    { name: "还剑湖老城区现代 5层大容量轰趴包栋", url: "https://www.airbnb.com/rooms/42991054", tag: "省心之选" },
    { name: "巴亭区带室内小型泳池现代极简住宅", url: "https://www.airbnb.com/rooms/51224790", tag: "出片神器" },
  ],
  bangkok: [
    { name: "曼谷市中心带私人泳池现代 6BR 轰趴豪宅", url: "https://www.airbnb.com/rooms/51336495", tag: "团队首选" },
    { name: "素坤逸区（Sukhumvit）奢华现代日式风包栋", url: "https://www.airbnb.com/rooms/41922543", tag: "省心之选" },
    { name: "考山路周边复古暹罗风大型独栋庄园", url: "https://www.airbnb.com/rooms/53110942", tag: "出片神器" },
  ],
  "ha-long-bay": [
    { name: "下龙湾沿海大型现代海景别墅包栋", url: "https://www.airbnb.com/ha-long-vietnam/stays/villas", tag: "团队首选" },
    { name: "巡洲岛（Tuan Chau）大型度假屋", url: "https://www.airbnb.com/ha-long-vietnam/stays", tag: "省心之选" },
    { name: "下龙市中心适合 12人+ 大团队多人房源", url: "https://www.airbnb.com/ha-long-vietnam/stays", tag: "出片神器" },
  ],
  "luang-prabang": [
    { name: "湄公河畔传统老挝木质大宅包栋", url: "https://www.airbnb.com/luang-prabang-laos/stays/villas", tag: "团队首选" },
    { name: "老城中心法式殖民风格大容量民宿", url: "https://www.airbnb.com/luang-prabang-laos/stays", tag: "省心之选" },
    { name: "琅勃拉邦适合 12人+ 隐世度假屋", url: "https://www.airbnb.com/luang-prabang-laos/stays", tag: "出片神器" },
  ],
  kathmandu: [
    { name: "泰米尔（Thamel）商圈大容量景观民宿", url: "https://www.airbnb.com/kathmandu-nepal/stays", tag: "团队首选" },
    { name: "博达哈（Boudha）近大佛塔高分大型房源", url: "https://www.airbnb.com/kathmandu-nepal/stays", tag: "省心之选" },
    { name: "加德满都谷地半山雪景庄园/别墅", url: "https://www.airbnb.com/kathmandu-nepal/stays/villas", tag: "出片神器" },
  ],
  "sri-lanka": [
    { name: "加勒古城荷兰殖民时期奢华庄园别墅", url: "https://www.airbnb.com/galle-sri-lanka/stays/villas", tag: "团队首选" },
    { name: "美蕊沙（Mirissa）一线海景大容量冲浪别邸", url: "https://www.airbnb.com/mirissa-sri-lanka/stays/villas", tag: "省心之选" },
    { name: "科伦坡市区现代多卧室高端豪宅包栋", url: "https://www.airbnb.com/colombo-sri-lanka/stays/villas", tag: "出片神器" },
  ],
  ulaanbaatar: [
    { name: "特日勒吉国家公园现代高级观星蒙古包包栋", url: "https://www.airbnb.com/ulaanbaatar-mongolia/stays", tag: "团队首选" },
    { name: "乌兰巴托市区 12人+ 大型现代公寓/住宅", url: "https://www.airbnb.com/ulaanbaatar-mongolia/stays", tag: "省心之选" },
    { name: "蒙古草原大容量野奢度假营地", url: "https://www.airbnb.com/ulaanbaatar-mongolia/stays", tag: "出片神器" },
  ],
  altay: [
    { name: "禾木风景区大容量图瓦人木屋民宿", url: "https://www.airbnb.com/altay-china/stays", tag: "团队首选" },
    { name: "阿勒泰市（将军山雪场旁）滑雪大包栋", url: "https://www.airbnb.com/altay-china/stays", tag: "省心之选" },
    { name: "布尔津县前往喀纳斯中转大户型高分房源", url: "https://www.airbnb.com/altay-china/stays", tag: "出片神器" },
  ],
};

function airbnbSearchUrl(keyword) {
  const params = new URLSearchParams({
    checkin: "2027-01-01",
    checkout: "2027-01-06",
    adults: "12",
    min_bedrooms: "6",
    search_type: "filter_change",
    source: "structured_search_input_header",
  });
  return `https://www.airbnb.com/s/${encodeURIComponent(keyword)}/homes?${params.toString()}`;
}

function makePlan(name, play, stayPhrase) {
  return [
    { day: travelDays[0], title: "抵达与集合", items: [`抵达${name}`, stayPhrase, "团队欢迎晚餐"] },
    { day: travelDays[1], title: "核心体验日", items: [play.split("、")[0] || "核心景点", "下午保留休息", "晚间自由聚餐"] },
    { day: travelDays[2], title: "自由分组日", items: ["一组轻松躺平", "一组探索城市/自然", "晚上合流聚餐"] },
    { day: travelDays[3], title: "团队高光日", items: ["安排最有记忆点的共同体验", "下午留白休息", "晚上 Happy 收官局"] },
    { day: travelDays[4], title: "返程日", items: ["睡到自然醒", "早午餐或伴手礼", "返程"] },
  ];
}

function makeDestination(config, index) {
  const staySearch = config.airbnbSearch || config.name;
  const flight = flightInfo[config.id] || "上海出发航程待确认";
  const category = config.category || categoryByDestinationId[config.id] || "custom";
  const categoryLabel = categoryGroups.find((group) => group.id === category)?.title || "目的地候选";
  return {
    id: config.id,
    name: config.name,
    headline: config.headline,
    score: 80,
    ribbon: `${config.recommender} 推荐`,
    recommender: config.recommender,
    category,
    summary: {
      ...config.summary,
      visaTraffic: `${config.summary.visaTraffic} 上海出发：${flight}。`,
    },
    tabs: {
      ...config.tabs,
      move: `${config.tabs.move} 上海出发：${flight}。`,
    },
    flight,
    analysis: analysisByDestination[config.id] || config.comment,
    links: {
      airbnb: airbnbSearchUrl(staySearch),
      foodPost: searchUrl("https://www.xiaohongshu.com/search_result?keyword=", `${config.name} 美食 攻略`),
      foodAddress: config.foodAddress,
    },
    airbnbCards: buildAirbnbCards(config.id, config.name, staySearch, config.tabs.stay),
    votes: { heart: [], veto: [] },
    comments: [{ member: config.recommender, text: config.comment }],
    pros: config.pros,
    cons: config.cons,
    coverCaption: categoryLabel.replace(/^[^\u4e00-\u9fa5A-Za-z0-9]+/, ""),
    photo: photoUrls[config.id]
      ? `url('${photoUrls[config.id]}')`
      : `linear-gradient(180deg, rgba(7, 14, 18, 0.05), rgba(7, 14, 18, 0.64)), ${palettes[index % palettes.length]}`,
    plan: config.plan || makePlan(config.name, config.tabs.play, config.tabs.stay),
  };
}

function buildAirbnbCards(destId, name, staySearch, stayText) {
  const listings = realAirbnbListings[destId];
  if (listings) {
    return listings.map((listing) => ({
      title: listing.name,
      meta: `${name} · 01.01-01.06`,
      tag: listing.tag,
      filter: "点击跳转真实房源页面",
      href: listing.url,
      note: `${name} · 12人 · 元旦日期`,
    }));
  }
  const options = [
    {
      title: "整栋 Villa / 大 House",
      meta: stayText,
      tag: "团队首选",
      query: `${staySearch} entire villa`,
      filter: "整套房源 · 适合12人聚会",
    },
    {
      title: "超赞房东 · 高评分",
      meta: "优先交通方便、餐厅密集、评价稳定",
      tag: "省心之选",
      query: `${staySearch} superhost apartment`,
      filter: "超赞房东 · 4.8分以上",
    },
    {
      title: "景观 / 度假感",
      meta: "优先海景、雪景、山景或特色住宿",
      tag: "出片神器",
      query: `${staySearch} scenic stay`,
      filter: "特色景观 · 拍照打卡",
    },
  ];
  return options.map((option) => ({
    ...option,
    href: airbnbSearchUrl(option.query),
    note: `${name} · 12人 · 6卧 · 01.01-01.06`,
  }));
}

const destinationSeeds = [
  {
    id: "phuket",
    name: "普吉岛",
    recommender: "Gemini",
    headline: "热带度假牌 —— villa、海滩和跳岛都很完整",
    summary: {
      visaTraffic: "泰国免签，上海/国内大城市航班多，落地后建议包车。",
      strength: "度假基础设施成熟，适合住大 villa、吃海鲜、安排跳岛。",
      limitation: "热门海滩商业化强，元旦前后天气和海况要预留弹性。",
    },
    tabs: {
      move: "免签 + 包车，机场到海滩区通常 45-90 分钟。",
      stay: "卡塔/卡伦/拉威优先整栋泳池 villa。",
      eat: "海鲜、泰南菜、夜市和海景餐厅。",
      play: "跳岛、海滩、按摩、日落酒吧。",
    },
    foodAddress: "推荐区域：Patong / Kata / Rawai 海鲜与夜市",
    comment: "经典海岛方案，适合想要热闹和度假感的人。",
    pros: ["villa 选择多，团队公共空间好。", "吃住玩成熟，首次组织风险低。", "自由活动和集体活动都好安排。"],
    cons: ["雨季可能影响跳岛。", "热门区域商业化和交通拥堵明显。", "如果只想安静度假，需要避开芭东核心区。"],
  },
  {
    id: "danang",
    name: "岘港",
    recommender: "Gemini",
    headline: "性价比之王 —— 一线海景与极致空间",
    summary: {
      visaTraffic: "越南电子签友好，直飞或转机都可控。",
      strength: "海景 villa 空间大，会安和巴拿山让 5 天行程很饱满。",
      limitation: "热门景点距离不短，雨天会影响海边体验。",
    },
    tabs: {
      move: "电子签 + 机场到美溪海滩约 20-35 分钟。",
      stay: "美溪海滩整栋 villa，泳池、客厅、厨房都能聚。",
      eat: "海鲜、越南粉、咖啡、会安小吃。",
      play: "巴拿山、会安古城、美溪海滩、按摩。",
    },
    foodAddress: "推荐区域：My Khe Beach / Han Market / Hoi An Ancient Town",
    comment: "同等预算下住宿空间和海边体验都很突出。",
    pros: ["住宿空间大，适合多人共处。", "海边、古城、咖啡和按摩都能覆盖。", "整体花费弹性好。"],
    cons: ["部分体验依赖天气。", "巴拿山和会安路程需要规划。", "热门海鲜店建议提前订。"],
  },
  {
    id: "jeju",
    name: "济州岛",
    recommender: "Gemini",
    headline: "免签海岛线 —— 黑猪肉、海风与包车慢游",
    summary: {
      visaTraffic: "济州免签政策友好，建议包车或分组打车。",
      strength: "海岛氛围明确，大 house、海岸线和咖啡都适合团队。",
      limitation: "公共交通弱，天气会明显影响户外体验。",
    },
    tabs: {
      move: "免签 + 包车最省心。",
      stay: "涯月或西归浦大 house，海景和客厅优先。",
      eat: "黑猪肉、海鲜锅、橘子甜品。",
      play: "牛岛、涯月海岸、咖啡与火山地貌。",
    },
    foodAddress: "推荐区域：Jeju-si / Aewol / Seogwipo",
    comment: "免签海岛，组织门槛比日本低。",
    pros: ["免签海岛，旅行感明确。", "大 house 选择多。", "自然景观和餐饮辨识度高。"],
    cons: ["团队移动需要包车。", "元旦天气要关注海风和降雨。", "夜生活不如曼谷、普吉丰富。"],
  },
  {
    id: "okinawa",
    name: "冲绳",
    recommender: "Gemini",
    headline: "精致日式流 —— 海滨 house、和牛与自驾海岛",
    summary: {
      visaTraffic: "需要日本签证，直飞那霸体验稳定。",
      strength: "海岛质感好，自驾、海边住宿和餐饮品质都稳定。",
      limitation: "签证和租车分工会增加前期协调。",
    },
    tabs: {
      move: "日本签证 + 直飞那霸，落地建议租车。",
      stay: "恩纳村/读谷村海景 house，适合做饭和聚餐。",
      eat: "和牛、冲绳面、海葡萄与居酒屋。",
      play: "水族馆、古宇利岛、美国村、海边日落。",
    },
    foodAddress: "推荐区域：Naha / Onna / Chatan American Village",
    comment: "如果大家签证没问题，整体质感更好。",
    pros: ["精致、干净，适合舒适型团队。", "海边 house 和自驾体验完整。", "餐饮品质稳定。"],
    cons: ["签证门槛更高。", "旺季住宿价格敏感。", "多人租车需要司机分工。"],
  },
  {
    id: "kota-kinabalu",
    name: "亚庇",
    recommender: "Gemini",
    headline: "日落海岛线 —— 海鲜、跳岛和低压度假",
    summary: {
      visaTraffic: "马来西亚入境相对友好，航班多需看转机。",
      strength: "日落、海鲜、跳岛体验轻松，节奏比普吉更低压。",
      limitation: "城市体量较小，5 天后段需要靠自然体验撑内容。",
    },
    tabs: {
      move: "关注直飞/转机，市区到机场较近。",
      stay: "市区海景公寓或郊区 villa，公共空间优先。",
      eat: "海鲜、肉骨茶、榴莲和夜市。",
      play: "跳岛、红树林、日落、神山轻体验。",
    },
    foodAddress: "推荐区域：Waterfront / Gaya Street / Welcome Seafood",
    comment: "适合想要海岛但不想太商业化的团队。",
    pros: ["日落和海鲜辨识度强。", "节奏轻松，适合低强度团队。", "城市尺度小，移动压力低。"],
    cons: ["航班衔接需要确认。", "住宿选择不如普吉丰富。", "雨天会削弱海岛体验。"],
  },
  {
    id: "harbin",
    name: "哈尔滨",
    recommender: "邹某",
    headline: "东北反差线 —— 俄式街区、烧烤和松花江夜风",
    summary: {
      visaTraffic: "国内无签证，航班和高铁均可；元旦正好踩中冰雪氛围。",
      strength: "城市美食和建筑辨识度强，组织成本低。",
      limitation: "元旦缺少冰雪核心卖点，需靠美食和城市漫游支撑。",
    },
    tabs: {
      move: "国内无签证，机场到市区约 40-60 分钟。",
      stay: "中央大街附近酒店套房或大平层，吃逛方便。",
      eat: "俄餐、铁锅炖、烧烤、锅包肉。",
      play: "中央大街、索菲亚教堂、松花江、音乐公园。",
    },
    foodAddress: "推荐区域：中央大街 / 老道外 / 师大夜市",
    comment: "不走常规海岛，吃和城市散步会很舒服。",
    pros: ["国内组织门槛低。", "餐饮非常适合集体聚餐。", "城市文化辨识度强。"],
    cons: ["元旦人流和价格都会上来。", "缺少海岛度假感。", "大 house 类住宿选择有限。"],
  },
  {
    id: "bali",
    name: "巴厘岛",
    recommender: "邹某",
    headline: "Villa 天花板 —— 泳池、稻田和海边仪式感",
    summary: {
      visaTraffic: "印尼落地/电子签政策需确认，通常需要转机。",
      strength: "团队 villa 体验极强，适合把住宿本身做成核心目的。",
      limitation: "飞行和岛内交通时间长，5 天会偏紧。",
    },
    tabs: {
      move: "关注签证政策和转机，岛内建议包车。",
      stay: "Canggu/Ubud/Seminyak 整栋 villa。",
      eat: "印尼菜、brunch、海边餐厅、烤猪饭。",
      play: "稻田、海滩、瑜伽、SPA、日落 club。",
    },
    foodAddress: "推荐区域：Canggu / Seminyak / Ubud",
    comment: "住宿体验很强，但飞行成本和假期长度要谨慎。",
    pros: ["villa 体验非常适合团队。", "度假氛围浓，照片和仪式感强。", "吃喝玩乐成熟。"],
    cons: ["5 天行程飞行占比高。", "岛内堵车会影响体验。", "签证和转机需提前确认。"],
  },
  {
    id: "luang-prabang",
    name: "琅勃拉邦",
    recommender: "邹某",
    headline: "慢旅行之王 —— 湄公河、寺庙和法式小城",
    summary: {
      visaTraffic: "老挝签证政策相对友好，航班通常需转机。",
      strength: "安静、独特、松弛，适合小众深度型团队。",
      limitation: "交通衔接和夜间活动较弱，不适合追求热闹。",
    },
    tabs: {
      move: "关注转机或铁路衔接，市区移动轻松。",
      stay: "古城客栈或整栋 villa，步行可达夜市。",
      eat: "老挝菜、法式面包、河边餐厅。",
      play: "布施、光西瀑布、夜市、湄公河日落。",
    },
    foodAddress: "推荐区域：Luang Prabang Old Town / Mekong Riverside",
    comment: "适合想逃离城市的人，气质很特别。",
    pros: ["目的地独特，有记忆点。", "节奏慢，适合放空。", "文化和自然都能覆盖。"],
    cons: ["交通不如热门海岛顺。", "夜生活少。", "团队成员若偏爱热闹可能无感。"],
  },
  {
    id: "kathmandu",
    name: "加德满都",
    recommender: "邹某",
    headline: "精神冒险线 —— 古城、雪山视野和强烈异域感",
    summary: {
      visaTraffic: "尼泊尔签证相对友好，航班需关注转机。",
      strength: "文化冲击强，适合想要非典型旅行的团队。",
      limitation: "城市基础设施和卫生条件需要心理预期。",
    },
    tabs: {
      move: "关注签证、转机和当地包车。",
      stay: "Thamel 或 Boudha 区精品酒店/公寓。",
      eat: "尼泊尔餐、momo、咖喱和咖啡馆。",
      play: "杜巴广场、博达哈大佛塔、纳加阔特日出。",
    },
    foodAddress: "推荐区域：Thamel / Boudha / Patan",
    comment: "很有冒险感，但不是所有人都能接受。",
    pros: ["目的地记忆点极强。", "文化和雪山视野独特。", "适合探索型团队。"],
    cons: ["舒适度和卫生预期要提前统一。", "交通和城市环境较混乱。", "5 天行程可能偏赶。"],
  },
  {
    id: "sri-lanka",
    name: "斯里兰卡",
    recommender: "邹某",
    headline: "印度洋环线 —— 茶园、海岸和野生动物",
    summary: {
      visaTraffic: "需确认电子签/入境政策，通常需要转机。",
      strength: "海岸、茶园、古城和野生动物组合丰富。",
      limitation: "点位分散，5 天只能做轻量海岸线版本。",
    },
    tabs: {
      move: "关注电子签和转机，落地建议包车。",
      stay: "Galle 或 Negombo 海边 villa。",
      eat: "海鲜、咖喱、椰子、锡兰红茶。",
      play: "加勒古城、海边、茶园轻体验或观鲸。",
    },
    foodAddress: "推荐区域：Galle Fort / Negombo / Colombo",
    comment: "内容很丰富，但元旦 5 天建议只选一条线。",
    pros: ["自然与文化组合丰富。", "海边 villa 体验好。", "目的地差异化强。"],
    cons: ["5 天很难完整环线。", "路程长，需要包车。", "签证和航班需核实。"],
  },
  {
    id: "ulaanbaatar",
    name: "乌兰巴托",
    recommender: "邹某",
    headline: "草原开阔感 —— 蒙古包、骑马和城市补给",
    summary: {
      visaTraffic: "需确认蒙古入境政策，航班季节性和价格要看。",
      strength: "草原体验开阔，团队记忆点强。",
      limitation: "住宿舒适度和车程需要提前统一预期。",
    },
    tabs: {
      move: "关注直飞/转机和草原包车。",
      stay: "市区酒店 + 草原营地蒙古包。",
      eat: "羊肉、奶茶、蒙餐和市区餐厅。",
      play: "特勒吉草原、骑马、成吉思汗广场。",
    },
    foodAddress: "推荐区域：Ulaanbaatar city center / Terelj",
    comment: "很适合做一次不一样的团队体验。",
    pros: ["草原体验辨识度极高。", "适合集体活动和户外拍照。", "元旦季节比冬天友好。"],
    cons: ["舒适度不如海岛 villa。", "车程和天气影响较大。", "餐饮选择相对单一。"],
  },
  {
    id: "altay",
    name: "阿勒泰",
    recommender: "邹某",
    headline: "国内自然大片 —— 草原、湖泊和北疆松弛感",
    summary: {
      visaTraffic: "国内无签证，需关注飞阿勒泰/乌鲁木齐中转。",
      strength: "自然风景强，适合想要户外和大片感的团队。",
      limitation: "点位距离长，5 天需要非常克制。",
    },
    tabs: {
      move: "国内无签证，建议落地包车。",
      stay: "阿勒泰市区酒店 + 景区附近民宿。",
      eat: "新疆菜、烤肉、奶茶、大盘鸡。",
      play: "喀纳斯轻量线、草原、湖泊、公路风景。",
    },
    foodAddress: "推荐区域：阿勒泰市区 / 布尔津 / 喀纳斯沿线",
    comment: "自然风光很强，但车程不能低估。",
    pros: ["国内顶级自然景观。", "无需出境手续。", "适合喜欢户外和摄影的人。"],
    cons: ["交通和车程压力较大。", "住宿公共空间不一定理想。", "元旦热门区域可能涨价。"],
  },
  {
    id: "sapporo",
    name: "札幌",
    recommender: "韩子",
    headline: "北海道清爽线 —— 海鲜、啤酒和城市近郊自然",
    summary: {
      visaTraffic: "需要日本签证，通常需飞札幌或转机。",
      strength: "餐饮稳定、城市干净，近郊自然体验舒服。",
      limitation: "元旦是北海道热门季，机酒和热门餐厅需要提前锁定。",
    },
    tabs: {
      move: "日本签证 + 关注直飞/转机札幌。",
      stay: "札幌站/大通附近公寓或连通房。",
      eat: "海鲜、拉面、成吉思汗烤肉、甜品。",
      play: "小樽、白色恋人、啤酒博物馆、近郊温泉。",
    },
    foodAddress: "推荐区域：Sapporo Station / Susukino / Nijo Market",
    comment: "喜欢吃和城市舒适度的人会比较稳。",
    pros: ["餐饮品质高。", "城市舒适、干净、适合慢逛。", "近郊可做轻量自然线。"],
    cons: ["日本签证门槛。", "元旦缺少雪季特色。", "住宿大 house 选择不如海岛。"],
  },
  {
    id: "jiangxi",
    name: "中国江西",
    recommender: "韩子",
    headline: "山水文化线 —— 景德镇、婺源和庐山任选主轴",
    summary: {
      visaTraffic: "国内无签证，高铁/飞机灵活。",
      strength: "文化、山水、陶瓷体验有层次，组织成本低。",
      limitation: "景点分散，必须收敛到一条路线。",
    },
    tabs: {
      move: "国内无签证，建议高铁落点明确。",
      stay: "景德镇/婺源精品民宿或整栋院子。",
      eat: "江西小炒、瓦罐汤、景德镇夜宵。",
      play: "景德镇陶瓷、婺源村落、庐山避暑。",
    },
    foodAddress: "推荐区域：景德镇陶溪川 / 婺源县城 / 南昌老城区",
    comment: "国内方案里更有内容厚度。",
    pros: ["国内组织简单。", "文化体验适合团队共创。", "住宿可找院落型民宿。"],
    cons: ["路线选择要收敛。", "元旦天气可能湿热。", "夜生活和海岛度假感弱。"],
  },
  {
    id: "guangxi",
    name: "中国广西",
    recommender: "韩子",
    headline: "山海双选线 —— 桂林山水或北部湾海边",
    summary: {
      visaTraffic: "国内无签证，南宁/桂林/北海均可作为入口。",
      strength: "山水和海边可二选一，团队接受度较高。",
      limitation: "如果同时想山和海，5 天会拉长车程。",
    },
    tabs: {
      move: "国内无签证，先定桂林线或北部湾线。",
      stay: "阳朔民宿院子或北海/防城港海边公寓。",
      eat: "桂林米粉、螺蛳粉、海鲜、老友粉。",
      play: "阳朔山水、漓江、北海银滩、防城港海边。",
    },
    foodAddress: "推荐区域：阳朔西街 / 北海侨港 / 防城港港口区",
    comment: "可以做成国内低压力版本。",
    pros: ["国内手续简单。", "山水和海边选择灵活。", "餐饮有地方特色。"],
    cons: ["路线容易贪多。", "元旦湿热和降雨要关注。", "高品质大 house 需要筛选。"],
  },
  {
    id: "nanning-fangchenggang",
    name: "广西南宁/防城港",
    recommender: "Louis",
    headline: "低压海鲜线 —— 南宁夜宵加北部湾海风",
    summary: {
      visaTraffic: "国内无签证，高铁/飞机到南宁后转防城港。",
      strength: "吃和海边都轻松，适合预算友好的国内团队。",
      limitation: "目的地高级感弱于出境海岛，需要靠住宿筛选补足。",
    },
    tabs: {
      move: "南宁集合，高铁或包车去防城港。",
      stay: "防城港海边公寓/别墅，南宁住市中心。",
      eat: "老友粉、越南风味、海鲜、夜宵。",
      play: "防城港海边、企沙、南宁夜市、青秀山。",
    },
    foodAddress: "推荐区域：南宁中山路 / 防城港企沙 / 港口区",
    comment: "国内海边加夜宵，组织压力小。",
    pros: ["国内出行最省手续。", "海鲜和夜宵适合集体聚餐。", "交通成本相对可控。"],
    cons: ["度假精致感有限。", "需要认真筛住宿。", "元旦天气湿热。"],
  },
  {
    id: "hanoi-ho-chi-minh",
    name: "越南河内/胡志明",
    recommender: "Louis",
    headline: "城市越南线 —— 咖啡、美食和殖民街区",
    summary: {
      visaTraffic: "越南电子签友好，河内/胡志明航班选择多。",
      strength: "城市吃喝密度高，咖啡和夜生活都好安排。",
      limitation: "河内和胡志明二选一更适合 5 天，不建议双城硬切。",
    },
    tabs: {
      move: "电子签 + 建议河内或胡志明二选一。",
      stay: "还剑湖/第一区大公寓，步行吃喝方便。",
      eat: "越南粉、法棍、咖啡、河粉和街头小吃。",
      play: "老城、咖啡馆、夜市、城市文化漫游。",
    },
    foodAddress: "推荐区域：Hanoi Old Quarter / Ho Chi Minh District 1",
    comment: "适合吃喝和城市探索，不是纯度假。",
    pros: ["航班和签证相对友好。", "美食密度高。", "城市自由活动方便。"],
    cons: ["双城不适合 5 天。", "交通和摩托车环境较混乱。", "大 house 不如海岛丰富。"],
  },
  {
    id: "bangkok",
    name: "曼谷",
    recommender: "Louis",
    headline: "城市松弛感 —— 美食、按摩和屋顶夜景",
    summary: {
      visaTraffic: "泰国免签，航班选择多，市内交通建议 BTS/MRT。",
      strength: "吃喝玩乐密度高，团队可自由分组。",
      limitation: "堵车明显，白天行程不能排太满。",
    },
    tabs: {
      move: "免签 + 航班多，市内优先轨道交通。",
      stay: "Sukhumvit 大公寓或酒店套房，出行最省心。",
      eat: "泰餐、夜市、咖啡、米其林小店。",
      play: "按摩、商场、夜市、屋顶 bar。",
    },
    foodAddress: "推荐区域：Sukhumvit / Siam / Chinatown / Chula",
    comment: "稳妥城市选项，适合吃和放松。",
    pros: ["餐饮选择密集，不怕众口难调。", "夜间活动丰富。", "免签和航班友好。"],
    cons: ["城市交通拥堵。", "海岛度假感弱。", "热门餐厅需要排队或预约。"],
  },
  {
    id: "ha-long-bay",
    name: "下龙湾",
    recommender: "Louis",
    headline: "海上巡游线 —— 喀斯特海湾和一晚船宿",
    summary: {
      visaTraffic: "越南电子签，通常从河内进出再接驳下龙湾。",
      strength: "海上巡游很有记忆点，适合团队一起体验。",
      limitation: "船宿舒适度差异大，天气会影响体验。",
    },
    tabs: {
      move: "电子签 + 河内接驳下龙湾约 2.5-3.5 小时。",
      stay: "一晚游船 + 河内一晚公寓/酒店。",
      eat: "船上海鲜、越南菜、河内咖啡。",
      play: "下龙湾巡游、皮划艇、洞穴、河内老城。",
    },
    foodAddress: "推荐区域：Ha Long cruise terminal / Hanoi Old Quarter",
    comment: "比普通城市线更有共同记忆点。",
    pros: ["团队共同体验强。", "风景独特，有仪式感。", "可和河内组合。"],
    cons: ["车程和船宿需要筛选。", "天气影响大。", "不适合晕船成员。"],
  },
];

const baseDestinations = destinationSeeds.map(makeDestination);
let destinations = [...baseDestinations];
let summaryExpanded = false;
let sortMode = "heart";
let commentsStore = {};
let categoryOpenState = categoryGroups.reduce((state, group) => {
  state[group.id] = true;
  return state;
}, {});

const screens = {
  create: document.querySelector("#screen-create"),
  generate: document.querySelector("#screen-generate"),
  join: document.querySelector("#screen-join"),
  workspace: document.querySelector("#screen-workspace"),
};

const navItems = document.querySelectorAll(".nav-item");
const cardsRoot = document.querySelector("#destinationCards");
const summaryTableBody = document.querySelector("#summaryTableBody");
const drawer = document.querySelector("#detailDrawer");
const drawerBackdrop = document.querySelector("#drawerBackdrop");
const drawerContent = document.querySelector("#drawerContent");
const modalBackdrop = document.querySelector("#modalBackdrop");
const countdownPill = document.querySelector("#countdownPill");
const memberNameInput = document.querySelector("#memberNameInput");
const joinProjectBtn = document.querySelector("#joinProjectBtn");
const joinStatus = document.querySelector("#joinStatus");
const shareLinkText = document.querySelector("#shareLinkText");

function rememberCurrentMember(id) {
  currentMemberId = id;
  try {
    localStorage.setItem("tripvote-member-id", id);
  } catch (error) {
    console.warn("Unable to persist member id locally.", error);
  }
}

function recoverJoinedMemberId(state, name, className, clientJoinId) {
  const membersInReverse = [...(state.members || [])].reverse();
  return (
    membersInReverse.find((member) => member.clientJoinId === clientJoinId)?.id ||
    membersInReverse.find((member) => member.name === name && member.className === className)?.id
  );
}

async function api(path, options = {}) {
  if (!path.startsWith("/api/")) {
    const response = await fetch(path, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });
    if (!response.ok) throw new Error(`API ${path} failed with ${response.status}`);
    return response.json();
  }

  // Prefer Firebase Realtime Database when available
  if (_fbDb) return firebaseApi(path, options);

  if (apiMode === "local") return localApi(path, options);

  const cloudEndpoint = path;
  const cgiEndpoint = `/cgi-bin/api.py?action=${path.slice(5)}`;
  const endpoints =
    apiMode === "cloud" ? [cloudEndpoint] : apiMode === "cgi" ? [cgiEndpoint] : [cloudEndpoint, cgiEndpoint];
  let lastError;
  for (const endpoint of endpoints) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(endpoint, {
        headers: { "Content-Type": "application/json" },
        ...options,
        signal: controller.signal,
      });
      if (response.ok) {
        apiMode = endpoint.startsWith("/cgi-bin/") ? "cgi" : "cloud";
        return response.json();
      }
      lastError = new Error(`API ${endpoint} failed with ${response.status}`);
      if (!endpoint.startsWith("/api/") || ![404, 405, 501].includes(response.status)) {
        break;
      }
    } catch (error) {
      lastError = error;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  // Fallback to localStorage when no server is reachable
  try {
    const result = localApi(path, options);
    apiMode = "local";
    return result;
  } catch {
    throw lastError || new Error(`API ${path} failed`);
  }
}

function setJoinStatus(message = "", tone = "muted") {
  joinStatus.textContent = message;
  joinStatus.dataset.tone = tone;
}

function applySharedState(state) {
  members = state.members || [];
  commentsStore = state.comments || {};
  const customDestinations = (state.customDestinations || []).map((destination, index) => {
    const hasRemoteCover = String(destination.photo || "").includes("source.unsplash");
    return {
      ...destination,
      links: {
        ...destination.links,
        airbnb: airbnbSearchUrl(destination.name),
      },
      airbnbCards: buildAirbnbCards(destination.id, destination.name, destination.name, destination.tabs?.stay || "优先找整套 house 或连通房，保证公共空间。"),
      coverCaption: destination.coverCaption || "成员私藏流",
      photo:
        !destination.photo || hasRemoteCover
          ? `linear-gradient(180deg, rgba(7, 14, 18, 0.05), rgba(7, 14, 18, 0.64)), ${palettes[index % palettes.length]}`
          : destination.photo,
      votes: state.votes?.[destination.id] || destination.votes || { heart: [], veto: [] },
    };
  });
  destinations = [...baseDestinations, ...customDestinations].map((destination) => ({
    ...destination,
    votes: state.votes?.[destination.id] || destination.votes || { heart: [], veto: [] },
  }));
  renderMembers();
}

async function refreshSharedState() {
  const state = await api("/api/state");
  applySharedState(state);
  renderWorkspace();
}

function currentMember() {
  return members.find((member) => member.id === currentMemberId);
}

function showScreen(name) {
  if (name === "workspace" && !currentMember()) {
    name = "join";
  }
  Object.values(screens).forEach((screen) => screen.classList.remove("active"));
  if (screens[name]) screens[name].classList.add("active");
  document.body.classList.remove("workspace-active");
  if (name === "workspace") renderWorkspace();
}

function syncProjectFromForm() {
  project.travelStartDate = document.querySelector("#travelStartDate").value || project.travelStartDate;
  updateCountdown();
}

function renderMembers() {
  /* member row removed from hero; nothing to render */
}

function updateCountdown() {
  const target = new Date(`${project.travelStartDate}T09:00:00`);
  const diff = target - new Date();
  if (Number.isNaN(diff)) {
    countdownPill.textContent = "出行时间待定";
    return;
  }
  const abs = Math.abs(diff);
  const days = Math.floor(abs / 86400000);
  const hours = Math.floor((abs % 86400000) / 3600000);
  const minutes = Math.floor((abs % 3600000) / 60000);
  const seconds = Math.floor((abs % 60000) / 1000);
  const label = diff >= 0 ? "" : "已出发";
  countdownPill.innerHTML =
    `<div class="countdown-unit ${label ? "elapsed" : ""}"><strong>${days}</strong><span>${label || "天"}</span></div>` +
    `<span class="countdown-colon">:</span>` +
    `<div class="countdown-unit"><strong>${String(hours).padStart(2, "0")}</strong><span>时</span></div>` +
    `<span class="countdown-colon">:</span>` +
    `<div class="countdown-unit"><strong>${String(minutes).padStart(2, "0")}</strong><span>分</span></div>` +
    `<span class="countdown-colon">:</span>` +
    `<div class="countdown-unit"><strong>${String(seconds).padStart(2, "0")}</strong><span>秒</span></div>`;
}

function voteStats(destination) {
  const v = destination.votes || { heart: [], veto: [] };
  return {
    heart: (v.heart || []).length,
    veto: (v.veto || []).length,
  };
}

function compareDestinations(a, b) {
  const aStats = voteStats(a);
  const bStats = voteStats(b);
  return bStats.heart - aStats.heart || aStats.veto - bStats.veto;
}

function compareDestinationsByVeto(a, b) {
  const aStats = voteStats(a);
  const bStats = voteStats(b);
  return bStats.veto - aStats.veto || aStats.heart - bStats.heart;
}

function memberName(id) {
  return members.find((member) => member.id === id)?.name || id;
}

function memberAvatars(ids) {
  if (!ids.length) return `<span class="empty-members">暂无</span>`;
  return ids
    .map((id) => {
      const member = members.find((item) => item.id === id);
      const cls = member?.className || "avatar-a";
      return `<span class="avatar tiny ${cls}" title="${memberName(id)}" aria-label="${memberName(id)}">${avatarEmojis[cls] || "😎"}</span>`;
    })
    .join("");
}

function allVoters(destination) {
  const v = destination.votes || { heart: [], veto: [] };
  return [...new Set([...(v.heart || []), ...(v.veto || [])])];
}

async function setVote(destinationId, voteType) {
  if (!currentMember()) {
    showScreen("join");
    return;
  }
  const state = await api("/api/vote", {
    method: "POST",
    body: JSON.stringify({ memberId: currentMemberId, destinationId, voteType }),
  });
  applySharedState(state);
  renderWorkspace();
}

function renderVoteButton(destination, voteType, symbol, label) {
  const v = destination.votes || { heart: [], veto: [] };
  const active = (v[voteType] || []).includes(currentMemberId);
  return `
    <button class="vote-button ${active ? "active" : ""}" data-action="vote" data-destination="${destination.id}" data-vote="${voteType}">
      <span class="vote-symbol">${symbol}</span>
      <span>${label}</span>
      <span class="vote-count">${(v[voteType] || []).length}</span>
    </button>
  `;
}

function groupByCategory(items) {
  return categoryGroups
    .map((group) => ({
      ...group,
      destinations: items.filter((destination) => destination.category === group.id),
    }))
    .filter((group) => group.destinations.length > 0);
}

function renderSummaryRow(destination, index) {
  const stats = voteStats(destination);
  const medals = ["🥇 Top1", "🥈 Top2", "🥉 Top3", "Top4", "Top5", "Top6", "Top7", "Top8", "Top9", "Top10", "Top11", "Top12", "Top13", "Top14", "Top15", "Top16", "Top17", "Top18", "Top19", "Top20"];
  return `
    <tr>
      <td>
        <span class="rank-badge">${medals[index] || `Top${index + 1}`}</span>
        <strong>${destination.name}</strong>
      </td>
      <td>${destination.summary.visaTraffic}</td>
      <td>${destination.summary.strength}</td>
      <td>${destination.summary.limitation}</td>
      <td><div class="summary-voters">${memberAvatars(allVoters(destination))}</div></td>
      <td>
        <div class="summary-votes">
          <span>♥ ${stats.heart}</span>
          <span>× ${stats.veto}</span>
        </div>
      </td>
    </tr>
  `;
}

function renderCompactTabs(destination) {
  return `
    <div class="compact-tabs">
      <article><b>行</b><span>${destination.tabs.move}</span></article>
      <article><b>住</b><span>${destination.tabs.stay}</span></article>
      <article><b>吃</b><span>${destination.tabs.eat}</span></article>
      <article><b>玩</b><span>${destination.tabs.play}</span></article>
    </div>
  `;
}

function renderDestinationCard(destination) {
  const stats = voteStats(destination);
  return `
    <article class="destination-card">
      ${destination.ribbon ? `<div class="recommend-ribbon">${destination.ribbon}</div>` : ""}
      <div class="destination-photo" style="--photo: ${destination.photo}">
        <strong>${destination.name}</strong>
        <span>${destination.coverCaption || "团队候选目的地"}</span>
      </div>
      <div class="destination-content">
        <div class="card-topline">
          <div>
            <h3>${destination.name}</h3>
            <p>${destination.headline}</p>
          </div>
        </div>
        ${renderCompactTabs(destination)}
        <div class="voter-row">
          <span>投票人</span>
          <div>${memberAvatars(allVoters(destination))}</div>
          <strong>♥${stats.heart} ×${stats.veto}</strong>
        </div>
      </div>
      <div class="vote-strip">
        ${renderVoteButton(destination, "heart", "♥", "投票")}
        ${renderVoteButton(destination, "veto", "×", "否决")}
        <button class="detail-button" data-action="detail" data-destination="${destination.id}">详情</button>
      </div>
    </article>
  `;
}

function renderWorkspace() {
  const groups = groupByCategory(destinations);
  cardsRoot.innerHTML = groups
    .map((group) => {
      const isOpen = categoryOpenState[group.id] !== false;
      const heart = group.destinations.reduce((sum, destination) => sum + voteStats(destination).heart, 0);
      const veto = group.destinations.reduce((sum, destination) => sum + voteStats(destination).veto, 0);
      return `
        <section class="destination-category ${isOpen ? "open" : "collapsed"}">
          <div class="destination-category-head">
            <div>
              <h3>${group.title}</h3>
              <p>${group.subtitle}</p>
            </div>
            <div class="category-actions">
              <span>${group.destinations.length} 个候选 · ♥ ${heart} · × ${veto}</span>
              <button data-action="toggle-category" data-category="${group.id}">${isOpen ? "收起" : "展开"}</button>
            </div>
          </div>
          <div class="category-grid" ${isOpen ? "" : "hidden"}>${group.destinations.map(renderDestinationCard).join("")}</div>
        </section>
      `;
    })
    .join("");
  const sorted = [...destinations].sort(sortMode === "veto" ? compareDestinationsByVeto : compareDestinations);
  const visibleCount = summaryExpanded ? sorted.length : 5;
  summaryTableBody.innerHTML = sorted.slice(0, visibleCount).map(renderSummaryRow).join("");
  const toggleBtn = document.querySelector("#toggleSummaryAll");
  if (toggleBtn) {
    const arrow = toggleBtn.querySelector(".expand-arrow");
    if (summaryExpanded) {
      toggleBtn.childNodes[0].textContent = "收起 ";
      if (arrow) arrow.classList.add("up");
    } else {
      toggleBtn.childNodes[0].textContent = `展开全部 (${sorted.length - 5}) `;
      if (arrow) arrow.classList.remove("up");
    }
    toggleBtn.style.display = sorted.length > 5 ? "" : "none";
  }
  syncProjectFromForm();
}

function voteMemberRow(destination, voteType, label) {
  const v = destination.votes || { heart: [], veto: [] };
  const ids = v[voteType] || [];
  return `
    <article>
      <strong>${label}：${ids.length}</strong>
      <div class="member-mini-row">${memberAvatars(ids)}</div>
    </article>
  `;
}

function renderPlanTabs(destination) {
  const firstDay = destination.plan[0];
  return `
    <div class="plan-tabs" data-plan-for="${destination.id}">
      <div class="plan-tab-list">
        ${destination.plan
          .map(
            (day, index) =>
              `<button class="${index === 0 ? "active" : ""}" data-action="day-tab" data-destination="${destination.id}" data-day="${index}">${day.day}</button>`,
          )
          .join("")}
      </div>
      <div class="day-panel" id="dayPanel-${destination.id}">
        <h3>${firstDay.title}</h3>
        <ul>${firstDay.items.map((item) => `<li>${item}</li>`).join("")}</ul>
      </div>
    </div>
  `;
}

function renderDetailSection(title, body, extra = "") {
  return `
    <section class="detail-section">
      <h2>${title}</h2>
      <p>${body}</p>
      ${extra}
    </section>
  `;
}

function renderAirbnbCards(destination) {
  return `
    <div class="airbnb-grid">
      ${destination.airbnbCards
        .map(
          (card, index) => `
            <a class="airbnb-card" href="${card.href}" target="_blank" rel="noreferrer">
              <div style="display:flex;justify-content:space-between;align-items:center;">
                <strong>🏡 ${card.title}</strong>
                <span class="airbnb-tag">${card.tag}</span>
              </div>
              <span>${card.meta}</span>
              <em>${card.filter}</em>
              <small>${card.note}</small>
            </a>
          `,
        )
        .join("")}
    </div>
    <p class="resource-note">点击卡片跳转 Airbnb 真实房源页面，可直接查看房源详情、图片和价格。</p>
  `;
}

function timeAgo(timestamp) {
  if (!timestamp) return "";
  const diff = Math.floor(Date.now() / 1000) - timestamp;
  if (diff < 60) return "刚刚";
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  return `${Math.floor(diff / 86400)} 天前`;
}

function renderCommentSection(destinationId) {
  const list = commentsStore[destinationId] || [];
  const bgColors = {
    "avatar-a": "#5b8dee", "avatar-b": "#e87ab5", "avatar-c": "#f5a623",
    "avatar-d": "#9b59b6", "avatar-e": "#27ae60", "avatar-f": "#e67e22",
    "avatar-g": "#2ecc71", "avatar-h": "#3498db", "avatar-i": "#e74c3c",
    "avatar-j": "#1abc9c",
  };
  const items = list.length
    ? list.map((c) => {
        const bg = bgColors[c.memberClass] || "#5b8dee";
        const emoji = avatarEmojis[c.memberClass] || "😎";
        return `
          <div class="comment-item">
            <div class="comment-avatar" style="background:${bg}">${emoji}</div>
            <div class="comment-body">
              <div class="comment-meta"><strong>${c.memberName}</strong><time>${timeAgo(c.createdAt)}</time></div>
              <div class="comment-text">${c.text}</div>
            </div>
          </div>`;
      }).join("")
    : `<div class="comment-empty">还没有评论，来说两句吧</div>`;
  return `
    <section class="detail-section comment-section">
      <h2>💬 讨论区 (${list.length})</h2>
      <div class="comment-list">${items}</div>
      <div class="comment-input-row">
        <input type="text" id="commentInput" placeholder="说说你的想法..." maxlength="200" />
        <button class="comment-send-btn" data-action="send-comment" data-destination="${destinationId}">发送</button>
      </div>
    </section>`;
}

function openDrawer(destinationId) {
  const destination = destinations.find((item) => item.id === destinationId);
  if (!destination) return;
  const stats = voteStats(destination);
  drawerContent.innerHTML = `
    <div class="drawer-hero" style="--photo: ${destination.photo}">
      ${destination.ribbon ? `<span class="recommend-ribbon in-hero">${destination.ribbon}</span>` : ""}
      <div>
        <p class="eyebrow">目的地详情</p>
        <h1>${destination.name}</h1>
        <span>${destination.headline}</span>
      </div>
    </div>
    <div class="drawer-quick-stats">
      <span>🗳 投票 ${stats.heart} 支持 · ${stats.veto} 否决</span>
      <span>✈️ ${destination.flight}</span>
    </div>
    <section class="detail-section analysis-section">
      <h2>🎯 适配分析</h2>
      <p>${destination.analysis}</p>
    </section>
    <section class="detail-section split">
      <div>
        <h2>✅ 优势</h2>
        <ul>${destination.pros.map((item) => `<li>${item}</li>`).join("")}</ul>
      </div>
      <div>
        <h2>⚠️ 局限性</h2>
        <ul>${destination.cons.map((item) => `<li>${item}</li>`).join("")}</ul>
      </div>
    </section>
    ${renderDetailSection("🚗 行 | 签证交通", destination.tabs.move)}
    ${renderDetailSection(
      "🏠 住 | 住宿方案",
      destination.tabs.stay,
      renderAirbnbCards(destination),
    )}
    ${renderDetailSection(
      "🍜 吃 | 推荐线索",
      destination.tabs.eat,
      `<div class="resource-pair"><a class="resource-link" href="${destination.links.foodPost}" target="_blank" rel="noreferrer">📕 小红书推荐</a><span>${destination.links.foodAddress}</span></div>`,
    )}
    <section class="detail-section">
      <h2>🎮 玩 | 出行计划</h2>
      <p>${destination.tabs.play}</p>
      ${renderPlanTabs(destination)}
    </section>
    <section class="detail-section">
      <h2>🗳 投票明细</h2>
      <div class="vote-members">
        ${voteMemberRow(destination, "heart", "✅ 支持")}
        ${voteMemberRow(destination, "veto", "❌ 否决")}
      </div>
    </section>
    ${renderCommentSection(destination.id)}
  `;
  drawerBackdrop.hidden = false;
  drawer.classList.add("open");
  drawer.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

function renderDayPanel(destinationId, dayIndex) {
  const destination = destinations.find((item) => item.id === destinationId);
  if (!destination) return;
  const day = destination.plan[dayIndex];
  const panel = document.querySelector(`#dayPanel-${destinationId}`);
  if (!panel || !day) return;
  panel.innerHTML = `<h3>${day.title}</h3><ul>${day.items.map((item) => `<li>${item}</li>`).join("")}</ul>`;
  document.querySelectorAll(`[data-plan-for="${destinationId}"] [data-action="day-tab"]`).forEach((button) => {
    button.classList.toggle("active", button.dataset.day === String(dayIndex));
  });
}

function closeDrawer() {
  drawerBackdrop.hidden = true;
  drawer.classList.remove("open");
  drawer.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

function openModal() {
  modalBackdrop.hidden = false;
}

function closeModal() {
  modalBackdrop.hidden = true;
}

async function addDestination() {
  if (!currentMember()) {
    showScreen("join");
    return;
  }
  const name = document.querySelector("#newDestinationName").value.trim() || "新目的地";
  const reason =
    document.querySelector("#newDestinationReason").value.trim() ||
    "成员追加的候选目的地，适合放入同一轮投票比较。";
  const member = members.find((item) => item.id === currentMemberId);
  const id = `${Date.now()}`;
  const destination = {
    id,
    name,
    headline: `${name} = 成员私藏线 —— ${reason}`,
    score: 76,
    ribbon: `${member?.name || "成员"} 推荐`,
    category: "custom",
    flight: "上海出发航程待确认",
    analysis: `${name} 是成员临时补充的私藏选项，适合先进入投票池观察真实兴趣。它的优势是代表了具体成员的偏好，不是系统泛泛推荐；风险是住宿、航班、签证/交通和餐饮信息还没有经过核验，适合先投票再深挖。`,
    summary: {
      visaTraffic: "按当前团队条件生成，需确认签证与交通。",
      strength: "来自成员主动推荐，代表真实兴趣。",
      limitation: "仍需补充真实住宿、餐饮和交通信息。",
    },
    tabs: {
      move: "先确认签证、直飞/转机和当地交通。",
      stay: "优先找整套 house 或连通房，保证公共空间。",
      eat: "围绕当地代表性餐厅做 1-2 顿核心聚餐。",
      play: "保留半天自由活动，避免新增方案过满。",
    },
    links: {
      airbnb: airbnbSearchUrl(name),
      foodPost: `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(`${name} 美食 攻略`)}`,
      foodAddress: "待补充店铺地址",
    },
    airbnbCards: buildAirbnbCards(id, name, name, "优先找整套 house 或连通房，保证公共空间。"),
    votes: { heart: [currentMemberId], veto: [] },
    comments: [{ member: member?.name || "成员", text: reason }],
    pros: ["成员真实推荐，讨论价值高。", "可以按团队偏好继续细化。"],
    cons: ["真实房源、餐厅和交通还需要核对。", "AI 初稿只能作为第一版对比。"],
    coverCaption: "成员私藏流",
    photo: `linear-gradient(180deg, rgba(7, 14, 18, 0.05), rgba(7, 14, 18, 0.64)), ${palettes[destinations.length % palettes.length]}`,
    plan: [
      { day: "01.01", title: "抵达与集合", items: ["抵达目的地", "入住团队住宿", "欢迎晚餐"] },
      { day: "01.02", title: "核心体验", items: ["代表性景点", "当地美食", "夜间自由活动"] },
      { day: "01.03", title: "自由分组", items: ["自然或文化路线", "下午自由", "团队聚餐"] },
      { day: "01.04", title: "团队高光", items: ["共同体验项目", "休息留白", "Happy 收官局"] },
      { day: "01.05", title: "返程", items: ["早午餐", "整理行李", "返程"] },
    ],
  };
  const state = await api("/api/destination", {
    method: "POST",
    body: JSON.stringify({ memberId: currentMemberId, destination }),
  });
  applySharedState(state);
  closeModal();
  showScreen("workspace");
  renderWorkspace();
}

document.querySelector("#toggleSummaryAll").addEventListener("click", () => {
  summaryExpanded = !summaryExpanded;
  renderWorkspace();
});

document.querySelectorAll(".sort-toggle").forEach((btn) => {
  btn.addEventListener("click", () => {
    sortMode = btn.dataset.sort;
    document.querySelectorAll(".sort-toggle").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    renderWorkspace();
  });
});

document.querySelector("#createProjectBtn").addEventListener("click", () => {
  syncProjectFromForm();
  showScreen("generate");
  setTimeout(() => showScreen("workspace"), 900);
});

joinProjectBtn.addEventListener("click", async () => {
  const name = memberNameInput.value.trim();
  if (!name) {
    setJoinStatus("先填一个昵称，再进入项目。", "error");
    memberNameInput.focus();
    return;
  }
  joinProjectBtn.disabled = true;
  joinProjectBtn.textContent = "进入中...";
  setJoinStatus("正在加入项目...", "muted");
  const selectedAvatar = document.querySelector(".avatar-picker .avatar.selected");
  const className = selectedAvatar?.dataset.avatar || "avatar-a";
  const clientJoinId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  try {
    let state;
    try {
      state = await api("/api/member", {
        method: "POST",
        body: JSON.stringify({ name, className, clientJoinId }),
      });
    } catch (error) {
      if (!String(error.message || "").includes("aborted")) throw error;
      await new Promise((resolve) => window.setTimeout(resolve, 800));
      state = await api("/api/state");
    }
    const joinedMemberId = state.currentMemberId || recoverJoinedMemberId(state, name, className, clientJoinId);
    if (!joinedMemberId) {
      throw new Error("加入项目失败：服务没有返回成员身份");
    }
    rememberCurrentMember(joinedMemberId);
    applySharedState(state);
    setJoinStatus("");
    showScreen("workspace");
  } catch (error) {
    console.error(error);
    setJoinStatus("暂时无法加入项目，请刷新页面再试，或确认云服务已经部署成功。", "error");
  } finally {
    joinProjectBtn.disabled = false;
    joinProjectBtn.textContent = "进入项目";
  }
});

memberNameInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    joinProjectBtn.click();
  }
});

cardsRoot.addEventListener("click", (event) => {
  const actionButton = event.target.closest("[data-action]");
  if (!actionButton) return;
  if (actionButton.dataset.action === "toggle-category") {
    const category = actionButton.dataset.category;
    categoryOpenState[category] = categoryOpenState[category] === false;
    renderWorkspace();
    return;
  }
  const destinationId = actionButton.dataset.destination;
  if (actionButton.dataset.action === "vote") setVote(destinationId, actionButton.dataset.vote);
  if (actionButton.dataset.action === "detail") openDrawer(destinationId);
});

drawer.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action='day-tab']");
  if (button) {
    renderDayPanel(button.dataset.destination, Number(button.dataset.day));
    return;
  }
  const sendBtn = event.target.closest("[data-action='send-comment']");
  if (sendBtn) {
    sendComment(sendBtn.dataset.destination);
  }
});

drawer.addEventListener("keyup", (event) => {
  if (event.key === "Enter" && event.target.id === "commentInput") {
    const destId = event.target.closest(".comment-section")?.querySelector("[data-action='send-comment']")?.dataset.destination;
    if (destId) sendComment(destId);
  }
});

async function sendComment(destinationId) {
  if (!currentMember()) { showScreen("join"); return; }
  const input = document.querySelector("#commentInput");
  const text = input?.value?.trim();
  if (!text) return;
  input.value = "";
  try {
    const state = await api("/api/comment", {
      method: "POST",
      body: JSON.stringify({ destinationId, memberId: currentMemberId, text }),
    });
    applySharedState(state);
    // Re-render comment section in drawer without full re-render
    const section = drawerContent.querySelector(".comment-section");
    if (section) {
      section.outerHTML = renderCommentSection(destinationId);
    }
  } catch (error) {
    console.error("Comment failed:", error);
  }
}

document.querySelector("#openAddDestination").addEventListener("click", openModal);
document.querySelector("#closeModal").addEventListener("click", closeModal);
document.querySelector("#addDestinationBtn").addEventListener("click", addDestination);
document.querySelector("#closeDrawer").addEventListener("click", closeDrawer);
drawerBackdrop.addEventListener("click", closeDrawer);
modalBackdrop.addEventListener("click", (event) => {
  if (event.target === modalBackdrop) closeModal();
});

document.querySelectorAll(".avatar-picker .avatar").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".avatar-picker .avatar").forEach((item) => item.classList.remove("selected"));
    button.classList.add("selected");
  });
});

document.querySelectorAll(".segmented button, .tag-cloud button").forEach((button) => {
  button.addEventListener("click", () => button.classList.toggle("selected"));
});

async function initApp() {
  if (shareLinkText) shareLinkText.textContent = window.location.href;
  await refreshSharedState();
  if (currentMember()) {
    showScreen("workspace");
  } else {
    showScreen("join");
  }
  setInterval(updateCountdown, 1000);
  if (_fbDb) {
    startFirebaseListener();
  } else {
    setInterval(async () => {
      if (screens.workspace.classList.contains("active")) {
        await refreshSharedState();
      }
    }, 3500);
  }
}

initApp().catch(() => {
  showScreen("join");
});
