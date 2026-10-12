// ============================================================
// Dataset Explorer & Creator - Hugging Face Static Space
// Versione per Space pubblico
//  - Nessun onclick inline (event delegation, compatibile con module)
//  - Token solo in sessionStorage (mai localStorage)
//  - Paginazione + autocomplete + sanitizzazione input API
//  - Filtro licenza corretto (parametro filter= dell'API HF)
//  - Doppia verifica client-side delle licenze
//  - ✨ OPZIONE A: copia la dataset card del dataset base
//  - ✨ OPZIONE C: auto-compilazione campi dal dataset base
// ============================================================

const HF_API_BASE = "https://huggingface.co/api";
const LICENSES = ["apache-2.0", "mit"];
const PAGE_SIZE = 50;

// ------------------------------------------------------------
// Stato globale
// ------------------------------------------------------------
let elements = {};
let hfToken = sessionStorage.getItem("hf_token") || "";
let currentLimit = PAGE_SIZE;
let allLoadedDatasets = [];
let currentFilters = {};

// ------------------------------------------------------------
// Inizializzazione
// ------------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
    console.log("🚀 Inizializzazione Dataset Explorer...");

    elements = {
        listSection: document.getElementById("list-section"),
        createSection: document.getElementById("create-section"),
        datasetList: document.getElementById("dataset-list"),
        licenseFilter: document.getElementById("license-filter"),
        searchInput: document.getElementById("search-input"),
        baseDatasetInput: document.getElementById("base-dataset-input"),
        baseDatasetSuggestions: document.getElementById("base-dataset-suggestions"),
        baseDatasetHidden: document.getElementById("base-dataset"),
        btnSubmit: document.getElementById("btn-submit"),
        loadMoreContainer: document.getElementById("load-more-container"),
        createStatus: document.getElementById("create-status"),
    };

    initializeTabs();
    setupEventListeners();
    loadDatasets(true);

    console.log("✅ Inizializzazione completata");
});

// ------------------------------------------------------------
// Utility
// ------------------------------------------------------------
function debounce(func, wait) {
    let timeout;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func(...args), wait);
    };
}

// Sanitizza qualsiasi stringa proveniente dall'API prima di inserirla nell'HTML
function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
}

function formatDate(dateString) {
    if (!dateString) return "Data sconosciuta";
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return "Data sconosciuta";
    const diffDays = Math.ceil(Math.abs(Date.now() - date) / 86400000);
    if (diffDays === 0) return "Oggi";
    if (diffDays === 1) return "Ieri";
    if (diffDays < 7) return `${diffDays} giorni fa`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} sett. fa`;
    return date.toLocaleDateString("it-IT");
}

function formatNumber(n) {
    if (!n) return "0";
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
    if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
    return String(n);
}

// Estrae le licenze dai tags (formato "license:xxx")
function extractLicenses(dataset) {
    const tags = dataset.tags || [];
    const licenses = tags
        .filter((t) => typeof t === "string" && t.startsWith("license:"))
        .map((t) => t.replace("license:", ""));
    if (licenses.length === 0 && dataset.cardData?.license) {
        licenses.push(dataset.cardData.license);
    }
    return licenses;
}

// Verifica client-side: il dataset ha almeno una delle licenze consentite?
function hasAllowedLicense(dataset) {
    const lic = extractLicenses(dataset).map((l) => l.toLowerCase());
    return lic.includes("apache-2.0") || lic.includes("mit");
}

// ------------------------------------------------------------
// Tab navigation
// ------------------------------------------------------------
function switchTab(tabId) {
    document.querySelectorAll("main section").forEach((s) => s.classList.remove("active"));
    document.getElementById(tabId)?.classList.add("active");

    document.querySelectorAll("nav button").forEach((b) => b.classList.remove("active"));
    const btnId = tabId === "list-section" ? "btn-list" : "btn-create";
    document.getElementById(btnId)?.classList.add("active");
}

function initializeTabs() {
    switchTab("list-section");
}

// ------------------------------------------------------------
// Caricamento dataset (con paginazione incrementale)
// ------------------------------------------------------------
async function loadDatasets(reset = true) {
    if (reset) {
        currentLimit = PAGE_SIZE;
        allLoadedDatasets = [];
        currentFilters = {
            license: elements.licenseFilter.value,
            search: elements.searchInput.value.trim(),
        };
        showLoading();
    } else {
        setLoadMoreLoading(true);
    }

    const { license, search } = currentFilters;
    const licenseList = license.includes(",") ? LICENSES : [license];

    try {
        const requests = licenseList.map(async (lic) => {
            // L'API HF filtra per tag tramite il parametro "filter="
            // (la licenza è un tag nel formato "license:xxx")
            let url = `${HF_API_BASE}/datasets` +
                `?filter=${encodeURIComponent("license:" + lic)}` +
                `&limit=${currentLimit}` +
                `&sort=downloads&direction=-1`;
            if (search) url += `&search=${encodeURIComponent(search)}`;

            const r = await fetch(url);
            if (!r.ok) throw new Error(`HTTP ${r.status} su ${lic}`);
            return r.json();
        });

        const results = await Promise.all(requests);

        // Unisce e deduplica per id
        const map = new Map();
        allLoadedDatasets.forEach((d) => map.set(d.id, d));
        results.flat().forEach((d) => map.set(d.id, d));
        allLoadedDatasets = [...map.values()];

        // Doppia verifica client-side: mostra solo dataset con
        // licenza esplicitamente dichiarata (apache-2.0 o mit)
        allLoadedDatasets = allLoadedDatasets.filter(hasAllowedLicense);

        // Ordina per downloads decrescenti
        allLoadedDatasets.sort((a, b) => (b.downloads || 0) - (a.downloads || 0));

        hideLoading();
        displayDatasets(allLoadedDatasets);
        updateLoadMoreButton();
    } catch (error) {
        console.error("❌ Errore caricamento:", error);
        hideLoading();
        showError(`
            <strong>Errore durante il caricamento dei dataset</strong><br>
            ${escapeHtml(error.message)}<br><br>
            <button data-action="retry-load">🔄 Riprova</button>
        `);
    } finally {
        setLoadMoreLoading(false);
    }
}

function updateLoadMoreButton() {
    elements.loadMoreContainer.innerHTML = "";

    if (allLoadedDatasets.length === 0) return;

    const btn = document.createElement("button");
    btn.id = "btn-load-more";
    btn.className = "load-more-btn";
    btn.dataset.action = "load-more";
    btn.textContent = `⬇️ Carica altri dataset (attuali: ${allLoadedDatasets.length})`;
    elements.loadMoreContainer.appendChild(btn);
}

function setLoadMoreLoading(loading) {
    const btn = document.getElementById("btn-load-more");
    if (!btn) return;
    btn.disabled = loading;
    btn.textContent = loading ? "⏳ Caricamento..." : btn.textContent;
}

// ------------------------------------------------------------
// Visualizzazione
// ------------------------------------------------------------
function displayDatasets(datasets) {
    elements.datasetList.innerHTML = "";

    if (!datasets || datasets.length === 0) {
        elements.datasetList.innerHTML = `
            <div class="no-results">
                <div class="no-results-icon">📭</div>
                <p>Nessun dataset trovato con questi filtri</p>
                <button data-action="retry-load">🔄 Ricarica</button>
            </div>`;
        return;
    }

    datasets.forEach((dataset, index) => {
        elements.datasetList.appendChild(createDatasetCard(dataset, index));
    });
}

function createDatasetCard(dataset, index) {
    const card = document.createElement("div");
    card.className = "dataset-card";
    card.style.animationDelay = `${Math.min(index * 0.05, 0.5)}s`;

    const licenses = extractLicenses(dataset);
    const licenseBadges = licenses
        .map((l) =>
            `<span class="license-badge license-${escapeHtml(l).replace(/[^a-z0-9-]/gi, "")}">${escapeHtml(l)}</span>`
        )
        .join("");

    const safeId = escapeHtml(dataset.id);

    card.innerHTML = `
        <div class="card-header">
            <h3 title="${safeId}">${safeId}</h3>
            <div class="badges">${licenseBadges}</div>
        </div>
        <div class="meta">
            <span>⬇️ ${formatNumber(dataset.downloads)}</span>
            <span>❤️ ${formatNumber(dataset.likes)}</span>
            <span>📅 ${escapeHtml(formatDate(dataset.lastModified))}</span>
        </div>
        <div class="tags">
            ${(dataset.tags || [])
                .filter((t) => typeof t === "string" && !t.startsWith("license:"))
                .slice(0, 5)
                .map((t) => `<span class="tag">${escapeHtml(t)}</span>`)
                .join("")}
        </div>
        <div class="actions">
            <button class="btn-view" data-id="${safeId}" data-action="view">👁️ Apri su HF</button>
            <button class="btn-use" data-id="${safeId}" data-action="use-base">🔄 Usa come base</button>
        </div>
    `;
    return card;
}

// ------------------------------------------------------------
// Messaggi UI
// ------------------------------------------------------------
function showLoading() {
    elements.datasetList.innerHTML = `
        <div id="loading-indicator">
            <div class="loading-spinner"></div>
            <p>Caricamento dataset...</p>
        </div>`;
}

function hideLoading() {
    document.getElementById("loading-indicator")?.remove();
}

function showError(html) {
    elements.datasetList.innerHTML = `
        <div class="error-message">
            <div class="error-icon">⚠️</div>
            <div class="error-content">${html}</div>
        </div>`;
}

function showInfo(message) {
    const existing = elements.datasetList.querySelector(".info-message");
    if (existing) existing.remove();

    const infoDiv = document.createElement("div");
    infoDiv.className = "info-message";
    infoDiv.innerHTML = message;
    elements.datasetList.insertBefore(infoDiv, elements.datasetList.firstChild);
    setTimeout(() => infoDiv.remove(), 5000);
}

function setCreateStatus(type, message) {
    elements.createStatus.innerHTML = message
        ? `<div class="status-${type}">${message}</div>`
        : "";
}

// ------------------------------------------------------------
// Azioni dataset
// ------------------------------------------------------------
function viewDatasetDetails(id) {
    window.open(`https://huggingface.co/datasets/${encodeURIComponent(id)}`, "_blank", "noopener");
}

function useDatasetAsBase(id) {
    switchTab("create-section");
    const radio = document.querySelector('input[name="mode"][value="inspired"]');
    if (radio) {
        radio.checked = true;
        switchCreationMode();
    }

    // Imposta il dataset base
    if (elements.baseDatasetInput && elements.baseDatasetHidden) {
        elements.baseDatasetInput.value = id;
        elements.baseDatasetHidden.value = id;
    }

    // ✨ OPZIONE C: auto-compila i campi dal dataset base
    autofillFieldsFromBase(id);

    showInfo(`✅ <strong>${escapeHtml(id)}</strong> selezionato come base (campi pre-compilati)`);
}

// ✨ OPZIONE C: pre-compila nome, licenza e descrizione dal dataset base
function autofillFieldsFromBase(baseId) {
    const baseDataset = allLoadedDatasets.find((d) => d.id === baseId);
    if (!baseDataset) return;

    // Licenza ereditata (solo se tra quelle consentite)
    const lic = extractLicenses(baseDataset)[0];
    if (lic === "apache-2.0" || lic === "mit") {
        const licenseSelect = document.getElementById("new-license");
        if (licenseSelect) licenseSelect.value = lic;
    }

    // Nome suggerito: ultima parte dell'id + suffisso "-derived" (solo se vuoto)
    const nameField = document.getElementById("new-name");
    if (nameField && !nameField.value.trim()) {
        const baseName = baseId.split("/").pop() || "dataset";
        nameField.value = baseName + "-derived";
    }

    // Descrizione suggerita (solo se vuota)
    const descField = document.getElementById("description");
    if (descField && !descField.value.trim()) {
        const baseDesc =
            baseDataset.cardData?.description ||
            baseDataset.description ||
            `Dataset derivato da ${baseId}.`;
        // Tronca a 500 caratteri (limite del campo)
        descField.value = baseDesc.slice(0, 500);
    }
}

// ------------------------------------------------------------
// Autocomplete dataset di base
// ------------------------------------------------------------
function setupBaseDatasetAutocomplete() {
    if (!elements.baseDatasetInput || !elements.baseDatasetSuggestions || !elements.baseDatasetHidden) return;

    elements.baseDatasetInput.addEventListener("input", debounce(() => {
        const q = elements.baseDatasetInput.value.toLowerCase().trim();
        elements.baseDatasetSuggestions.innerHTML = "";
        elements.baseDatasetHidden.value = "";
        if (!q) return;

        const matches = allLoadedDatasets
            .filter((d) => d.id && d.id.toLowerCase().includes(q))
            .slice(0, 8);

        matches.forEach((d) => {
            const item = document.createElement("div");
            item.className = "suggestion-item";
            item.textContent = d.id;
            item.addEventListener("click", () => {
                elements.baseDatasetInput.value = d.id;
                elements.baseDatasetHidden.value = d.id;
                elements.baseDatasetSuggestions.innerHTML = "";

                // ✨ OPZIONE C: auto-compila anche da autocomplete
                autofillFieldsFromBase(d.id);

                showInfo(`✅ <strong>${escapeHtml(d.id)}</strong> selezionato come base (campi pre-compilati)`);
            });
            elements.baseDatasetSuggestions.appendChild(item);
        });
    }, 250));

    // Chiude i suggerimenti cliccando fuori
    document.addEventListener("click", (e) => {
        if (!elements.baseDatasetSuggestions.contains(e.target) && e.target !== elements.baseDatasetInput) {
            elements.baseDatasetSuggestions.innerHTML = "";
        }
    });
}

// ------------------------------------------------------------
// Creazione dataset
// ------------------------------------------------------------
function switchCreationMode() {
    const mode = document.querySelector('input[name="mode"]:checked')?.value;
    document.querySelectorAll(".creation-form").forEach((f) => f.classList.remove("active"));

    if (mode === "inspired") {
        document.getElementById("inspired-form")?.classList.add("active");
    } else {
        document.getElementById("scratch-form")?.classList.add("active");
    }
}

function validateDatasetName(name) {
    if (!name) return "Il nome del dataset è obbligatorio";
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name))
        return "Il nome può contenere solo lettere, numeri, punti, trattini e underscore";
    if (name.length > 96) return "Il nome è troppo lungo (max 96 caratteri)";
    return null;
}

async function requestToken() {
    if (hfToken) return hfToken;

    const token = prompt(
        "🔐 Per creare un dataset reale serve un token Hugging Face con permesso di scrittura (tipo 'Write').\n\n" +
        "Generalo qui: https://huggingface.co/settings/tokens\n\n" +
        "Il token verrà salvato SOLO per questa sessione del browser e usato esclusivamente " +
        "per comunicare con huggingface.co. Inseriscilo qui (lascia vuoto per annullare):"
    );

    if (!token) return null;

    hfToken = token.trim();
    sessionStorage.setItem("hf_token", hfToken);
    return hfToken;
}

async function handleCreateDataset() {
    const mode = document.querySelector('input[name="mode"]:checked')?.value;

    let name, license, description, baseId;
    if (mode === "inspired") {
        baseId = elements.baseDatasetHidden?.value.trim();
        name = document.getElementById("new-name")?.value.trim();
        license = document.getElementById("new-license")?.value;
        description = document.getElementById("description")?.value.trim();
        if (!baseId) {
            setCreateStatus("error", "⚠️ Seleziona prima un dataset di base (oppure passa a 'Da zero').");
            return;
        }
    } else {
        name = document.getElementById("dataset-name")?.value.trim();
        license = document.getElementById("scratch-license")?.value;
        description = document.getElementById("scratch-description")?.value.trim();
    }

    const nameError = validateDatasetName(name);
    if (nameError) {
        setCreateStatus("error", "⚠️ " + escapeHtml(nameError));
        return;
    }

    const token = await requestToken();
    if (!token) {
        setCreateStatus("error", "❌ Senza token non è possibile creare il dataset sull'Hub.");
        return;
    }

    elements.btnSubmit.disabled = true;
    elements.btnSubmit.textContent = "⏳ Creazione in corso...";
    setCreateStatus("info", "⏳ Creazione del repository in corso...");

    try {
        // 1. Crea il repository
        const response = await fetch("https://huggingface.co/api/repos/create", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${token}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                type: "dataset",
                name: name,
                private: false,
            }),
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            // Token invalido -> reset per richiederne uno nuovo
            if (response.status === 401 || response.status === 403) {
                hfToken = "";
                sessionStorage.removeItem("hf_token");
                throw new Error("Token non valido o senza permessi di scrittura. Riprova con un nuovo token.");
            }
            throw new Error(err.error || `HTTP ${response.status}`);
        }

        const result = await response.json();
        const fullId = result.repoId || `${result.url?.split("/").slice(-2).join("/") || name}`;

        // 2. Carica la dataset card (README.md)
        setCreateStatus("info", "⏳ Scrittura della dataset card (README.md)...");
        await uploadDatasetCard(fullId, license, description, mode === "inspired" ? baseId : null, token);

        setCreateStatus(
            "success",
            `✅ Dataset <strong>${escapeHtml(fullId)}</strong> creato con successo! ` +
            `<a href="https://huggingface.co/datasets/${encodeURIComponent(fullId)}" target="_blank" rel="noopener">Apri su Hugging Face →</a>`
        );

        // Reset form
        if (document.getElementById("new-name")) document.getElementById("new-name").value = "";
        if (document.getElementById("description")) document.getElementById("description").value = "";
        if (document.getElementById("dataset-name")) document.getElementById("dataset-name").value = "";
        if (document.getElementById("scratch-description")) document.getElementById("scratch-description").value = "";
        if (elements.baseDatasetInput) elements.baseDatasetInput.value = "";
        if (elements.baseDatasetHidden) elements.baseDatasetHidden.value = "";

        // Aggiorna la lista in background
        loadDatasets(true);
    } catch (error) {
        console.error("❌ Errore creazione:", error);
        setCreateStatus("error", "❌ <strong>Errore durante la creazione:</strong><br>" + escapeHtml(error.message));
    } finally {
        elements.btnSubmit.disabled = false;
        elements.btnSubmit.textContent = "🚀 Crea Dataset";
    }
}

// ✨ OPZIONE A: carica il README.md nel nuovo dataset.
// Se il dataset base ha una card, la usa come punto di partenza
// (sostituendo la licenza nel frontmatter e aggiungendo l'attribuzione).
async function uploadDatasetCard(repoId, license, description, inspiredFrom, token) {
    const safeLicense = license === "mit" ? "mit" : "apache-2.0";
    let readmeContent;

    // 1. Prova a scaricare la card del dataset base
    let baseCardContent = "";
    if (inspiredFrom) {
        try {
            const r = await fetch(
                `https://huggingface.co/datasets/${encodeURIComponent(inspiredFrom)}/raw/main/README.md`
            );
            if (r.ok) baseCardContent = await r.text();
        } catch (e) {
            console.warn("Card base non scaricabile:", e);
        }
    }

    if (baseCardContent) {
        // 2a. Usa la card base come punto di partenza
        readmeContent = baseCardContent;

        // Sostituisci/inserisci la licenza nel frontmatter YAML
        if (readmeContent.startsWith("---")) {
            // Sostituisce il frontmatter esistente mantenendo gli altri metadati
            // ma forzando la nuova licenza
            const fmMatch = readmeContent.match(/^---\n([\s\S]*?)\n---/);
            if (fmMatch) {
                let frontmatter = fmMatch[1];
                // Rimuove eventuale vecchia riga license
                frontmatter = frontmatter.replace(/^license:.*$/m, "").trim();
                readmeContent = `---\nlicense: ${safeLicense}\n${frontmatter ? frontmatter + "\n" : ""}---` +
                    readmeContent.slice(fmMatch[0].length);
            }
        } else {
            // Nessun frontmatter: aggiungine uno nuovo
            readmeContent = `---\nlicense: ${safeLicense}\n---\n\n${readmeContent}`;
        }

        // Aggiunge la sezione di attribuzione in coda
        readmeContent +=
            `\n\n---\n\n` +
            `## 📌 Attribuzione\n\n` +
            `Questo dataset è **ispirato a** [${inspiredFrom}](https://huggingface.co/datasets/${inspiredFrom}).\n` +
            `La struttura di questa card è derivata dalla card originale.\n\n` +
            `> ℹ️ I dati NON sono stati copiati automaticamente. Per duplicare i dati dal dataset originale ` +
            `(lecito grazie alla licenza ${safeLicense}), usa la CLI di Hugging Face:\n\n` +
            "```bash\n" +
            `huggingface-cli download ${inspiredFrom} --repo-type dataset --local-dir ./data\n` +
            `huggingface-cli upload ${repoId} ./data --repo-type dataset\n` +
            "```\n";
    } else {
        // 2b. Fallback: card generica (comportamento precedente)
        const safeDescription = description || "Dataset creato con Dataset Explorer & Creator.";
        readmeContent =
            `---\nlicense: ${safeLicense}\n---\n\n` +
            `# ${repoId}\n\n${safeDescription}\n\n` +
            (inspiredFrom
                ? `> Dataset ispirato a: [${inspiredFrom}](https://huggingface.co/datasets/${inspiredFrom})\n`
                : "");
    }

    // 3. Upload tramite endpoint di commit
    const commitUrl = `https://huggingface.co/api/datasets/${encodeURIComponent(repoId)}/commit/main`;
    const payload = {
        additions: [{ path: "README.md", content: readmeContent }],
    };

    const response = await fetch(commitUrl, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        console.warn("⚠️ README non caricato:", response.status);
        // Il repo esiste comunque: non bloccare il flusso
    }
}

// ------------------------------------------------------------
// Event listeners (event delegation — nessun onclick inline)
// ------------------------------------------------------------
function setupEventListeners() {
    // Filtri lista
    elements.licenseFilter?.addEventListener("change", () => loadDatasets(true));
    elements.searchInput?.addEventListener("input", debounce(() => loadDatasets(true), 400));

    // Navigazione tab
    document.getElementById("btn-list")?.addEventListener("click", () => switchTab("list-section"));
    document.getElementById("btn-create")?.addEventListener("click", () => switchTab("create-section"));

    // Delegazione: tutti i bottoni dinamici dentro #dataset-list e #load-more-container
    elements.datasetList?.addEventListener("click", (e) => {
        const btn = e.target.closest("button");
        if (!btn) return;

        if (btn.dataset.action === "view") {
            viewDatasetDetails(btn.dataset.id);
        } else if (btn.dataset.action === "use-base") {
            useDatasetAsBase(btn.dataset.id);
        } else if (btn.dataset.action === "retry-load") {
            loadDatasets(true);
        }
    });

    elements.loadMoreContainer?.addEventListener("click", (e) => {
        if (e.target.dataset.action === "load-more") {
            currentLimit = Math.min(currentLimit + PAGE_SIZE, 200);
            loadDatasets(false);
        }
    });

    // Form creazione
    document.querySelectorAll('input[name="mode"]').forEach((radio) =>
        radio.addEventListener("change", switchCreationMode)
    );

    elements.btnSubmit?.addEventListener("click", handleCreateDataset);

    // Autocomplete
    setupBaseDatasetAutocomplete();
}
