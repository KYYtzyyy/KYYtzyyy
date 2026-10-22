
/*
 * AniBay frontend
 * Lokal: http://127.0.0.1:8000
 * Setelah deploy: ganti API_BASE dengan URL backend FastAPI milikmu.
 */
const API_BASE = "http://127.0.0.1:8000";

const $ = (selector) => document.querySelector(selector);
const grid = $("#anime-grid");
const statusMessage = $("#status-message");
const dialog = $("#detail-dialog");

let currentPage = 1;
let currentMode = "trending";
let currentSearch = "";
let selectedEndpoint = "home";
let busy = false;

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[char]);

function normalizeList(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];

  for (const key of ["anime", "results", "items", "data", "list"]) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  if (payload.data && typeof payload.data === "object") {
    for (const key of ["anime", "results", "items", "list"]) {
      if (Array.isArray(payload.data[key])) return payload.data[key];
    }
  }
  return [];
}

function animeFields(item = {}) {
  return {
    id: item.id ?? item.animeId ?? item.slug ?? "",
    title: item.title ?? item.titleEnglish ?? item.name ?? "Untitled anime",
    image: item.posterUrl ?? item.imageUrl ?? item.coverImage ??
      item.poster ?? item.image ?? item.thumbnail ?? "",
    score: item.score ?? item.rating ?? null,
    type: item.type ?? item.format ?? "Anime",
    year: item.seasonYear ?? item.year ?? "",
    synopsis: item.synopsis ?? item.description ?? "",
    genres: Array.isArray(item.genres)
      ? item.genres.map(g => typeof g === "string" ? g : g?.name).filter(Boolean)
      : []
  };
}

function setStatus(message, isError = false) {
  statusMessage.textContent = message;
  statusMessage.classList.toggle("error", isError);
}

async function apiGet(path) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { Accept: "application/json" }
  });

  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { message: text.slice(0, 500) };
  }

  if (!response.ok) {
    const detail = data?.error?.message ?? data?.error?.detail ??
      data?.detail ?? data?.message ?? `HTTP ${response.status}`;
    throw new Error(`${detail} (HTTP ${response.status})`);
  }
  return data;
}

function showEmpty(message) {
  grid.innerHTML = `<div class="empty-state">${escapeHtml(message)}</div>`;
}

function renderAnime(items, append = false) {
  if (!append) grid.replaceChildren();

  if (!items.length && !append) {
    showEmpty("Belum ada data anime yang bisa ditampilkan.");
    return;
  }

  const fragment = document.createDocumentFragment();

  items.forEach((item) => {
    const anime = animeFields(item);
    const card = document.createElement("article");
    card.className = "anime-card";
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", `Lihat detail ${anime.title}`);
    card.dataset.id = anime.id;

    const poster = document.createElement("div");
    poster.className = "poster";

    if (anime.image && /^https?:\/\//i.test(anime.image)) {
      const img = document.createElement("img");
      img.src = anime.image;
      img.alt = `Poster ${anime.title}`;
      img.loading = "lazy";
      img.referrerPolicy = "no-referrer";
      img.onerror = () => {
        poster.innerHTML = '<div class="poster-placeholder" aria-label="Poster tidak tersedia">✦</div>';
      };
      poster.append(img);
    } else {
      poster.innerHTML = '<div class="poster-placeholder" aria-label="Poster tidak tersedia">✦</div>';
    }

    if (anime.score !== null && anime.score !== "") {
      const score = document.createElement("span");
      score.className = "score";
      score.textContent = `★ ${anime.score}`;
      poster.append(score);
    }

    const type = document.createElement("span");
    type.className = "type-tag";
    type.textContent = anime.type;
    poster.append(type);

    const title = document.createElement("h3");
    title.textContent = anime.title;

    const meta = document.createElement("div");
    meta.className = "anime-meta";
    meta.textContent = [anime.year, anime.type].filter(Boolean).join(" · ");

    card.append(poster, title, meta);
    card.addEventListener("click", () => openAnime(anime));
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openAnime(anime);
      }
    });
    fragment.append(card);
  });

  grid.append(fragment);
}

async function loadCatalog({ append = false } = {}) {
  if (busy) return;
  busy = true;
  $("#load-more").disabled = true;
  setStatus("Memuat data anime...");

  try {
    let path;

    if (currentSearch) {
      path = `/api/search?query=${encodeURIComponent(currentSearch)}`;
    } else if (currentMode === "browse") {
      path = `/api/browse?page=${currentPage}`;
    } else {
      path = `/api/trending?section=${encodeURIComponent(currentMode)}`;
    }

    const payload = await apiGet(path);
    const items = normalizeList(payload);
    renderAnime(items, append);

    const total = payload?.total ?? payload?.data?.total;
    setStatus(items.length
      ? `${items.length} anime dimuat${total != null ? ` · total ${total}` : ""}.`
      : "API merespons, tetapi daftar anime tidak ditemukan pada format JSON yang dikenali.",
      !items.length);
  } catch (error) {
    if (!append) showEmpty("Data belum tersedia. Periksa koneksi API atau coba lagi.");
    setStatus(`Gagal memuat katalog: ${error.message}`, true);
  } finally {
    busy = false;
    $("#load-more").disabled = false;
  }
}

async function openAnime(anime) {
  const detailHost = $("#detail-content");
  dialog.showModal();
  detailHost.innerHTML = "<p>Memuat detail anime...</p>";

  let detail = anime;
  if (anime.id) {
    try {
      const response = await apiGet(`/api/anime/${encodeURIComponent(anime.id)}`);
      detail = response?.anime ?? response?.data ?? response;
    } catch (error) {
      detailHost.innerHTML =
        `<p>Detail dari API tidak tersedia: ${escapeHtml(error.message)}</p>`;
      return;
    }
  }

  const item = animeFields(detail);
  const genres = item.genres.length
    ? item.genres.join(" · ")
    : "Genre tidak tersedia";

  const poster = item.image && /^https?:\/\//i.test(item.image)
    ? `<img src="${escapeHtml(item.image)}" alt="Poster ${escapeHtml(item.title)}">`
    : `<div class="poster-placeholder">✦</div>`;

  detailHost.innerHTML = `
    <div class="detail-layout">
      <div>${poster}</div>
      <div>
        <span class="section-kicker">ANIME DETAILS</span>
        <h2>${escapeHtml(item.title)}</h2>
        <div class="detail-genres">${escapeHtml(genres)}</div>
        <p>${escapeHtml(item.synopsis || "Sinopsis belum tersedia dari API.")}</p>
        <p>Type: ${escapeHtml(item.type)}${item.year ? ` · ${escapeHtml(item.year)}` : ""}</p>
      </div>
    </div>`;
}

$("#close-detail").addEventListener("click", () => dialog.close());
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
});

$("#search-form").addEventListener("submit", (event) => {
  event.preventDefault();
  currentSearch = $("#search-input").value.trim();
  currentPage = 1;
  loadCatalog();
});

$("#section-select").addEventListener("change", (event) => {
  currentMode = event.target.value;
  currentSearch = "";
  $("#search-input").value = "";
  currentPage = 1;
  loadCatalog();
});

$("#refresh-button").addEventListener("click", () => loadCatalog());

$("#load-more").addEventListener("click", () => {
  if (currentSearch) {
    setStatus("Pencarian saat ini tidak memiliki kontrol halaman pada UI.");
    return;
  }
  currentPage += 1;
  currentMode = "browse";
  $("#section-select").value = "trending";
  loadCatalog({ append: true });
});

// API Explorer: endpoint dipilih dari daftar terbatas.
document.querySelectorAll(".route-button").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".route-button").forEach((item) => {
      item.classList.remove("selected");
    });
    button.classList.add("selected");
    selectedEndpoint = button.dataset.endpoint;
    $("#selected-route").textContent = `GET ${
      ({
        home: "/home",
        browse: "/browse",
        filters: "/browse/filters",
        trending: "/sections/trending",
        schedule: "/schedule"
      })[selectedEndpoint]
    }`;
    $("#console-status").textContent = "Siap menjalankan request.";
  });
});

$("#run-endpoint").addEventListener("click", async () => {
  const output = $("#console-output");
  const status = $("#console-status");
  status.textContent = "Request sedang berjalan...";
  output.textContent = "";

  const started = performance.now();
  try {
    const result = await apiGet(`/api/explorer?endpoint=${encodeURIComponent(selectedEndpoint)}`);
    const duration = Math.round(performance.now() - started);
    status.textContent = `Berhasil · HTTP 200 · ${duration} ms`;
    output.textContent = JSON.stringify(result, null, 2);
  } catch (error) {
    status.textContent = `Request gagal · ${error.message}`;
    output.textContent = JSON.stringify({ error: error.message }, null, 2);
  }
});

// Tema awal mengikuti sistem. Tombol mengganti tema secara manual.
const themeButton = $("#theme-toggle");
const root = document.documentElement;

function applyTheme(theme) {
  root.classList.toggle("light", theme === "light");
  themeButton.textContent = theme === "light" ? "☾" : "☼";
}

const savedTheme = localStorage.getItem("anibay-theme");
const systemTheme = window.matchMedia("(prefers-color-scheme: light)").matches
  ? "light" : "dark";
applyTheme(savedTheme || systemTheme);

themeButton.addEventListener("click", () => {
  const next = root.classList.contains("light") ? "dark" : "light";
  applyTheme(next);
  localStorage.setItem("anibay-theme", next);
});

loadCatalog();
