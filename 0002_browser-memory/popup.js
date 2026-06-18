// popup.js
// Handle saving current page and searching saved documents

const saveBtn = document.getElementById('saveBtn');
const searchInput = document.getElementById('searchInput');
const resultsDiv = document.getElementById('results');

let docs = [];

function renderResults(results) {
  resultsDiv.innerHTML = '';
  results.forEach((doc) => {
    const div = document.createElement('div');
    div.className = 'doc';
    const date = new Date(doc.createdAt).toLocaleString();
    div.innerHTML = `
      <div class="doc-title">${doc.title}</div>
      <div><a href="${doc.url}" target="_blank">${doc.url}</a></div>
      <div style="font-size: 0.8em; color: #777;">Saved: ${date}</div>
    `;
    resultsDiv.appendChild(div);
  });
}

function loadDocuments() {
  chrome.runtime.sendMessage({ type: 'fetchAll' }, (response) => {
    if (response && response.docs) {
      docs = response.docs;
      renderResults(docs);
    } else {
      docs = [];
      renderResults([]);
    }
  });
}

// Extraction runs in the page context via chrome.scripting.executeScript.
// Defined as a standalone function so it can be injected on demand —
// this works even on tabs that were already open before the extension loaded.
function extractPageData() {
  return {
    title: document.title,
    url: location.href,
    text: document.body ? document.body.innerText || '' : '',
    createdAt: Date.now(),
  };
}

function setStatus(message) {
  const original = saveBtn.textContent;
  saveBtn.textContent = message;
  saveBtn.disabled = true;
  setTimeout(() => {
    saveBtn.textContent = original;
    saveBtn.disabled = false;
  }, 1200);
}

// Save current tab's page content
saveBtn.addEventListener('click', () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab || !tab.id) {
      setStatus('No active tab');
      return;
    }

    chrome.scripting.executeScript(
      { target: { tabId: tab.id }, func: extractPageData },
      (results) => {
        if (chrome.runtime.lastError) {
          // Common on chrome:// pages, the Web Store, and other restricted URLs
          console.error('Extract failed:', chrome.runtime.lastError.message);
          setStatus("Can't save this page");
          return;
        }

        const pageData = results && results[0] && results[0].result;
        if (!pageData) {
          setStatus("Can't save this page");
          return;
        }

        chrome.runtime.sendMessage({ type: 'save', payload: pageData }, () => {
          if (chrome.runtime.lastError) {
            console.error('Save failed:', chrome.runtime.lastError.message);
            setStatus('Save failed');
            return;
          }
          setStatus('Saved!');
          loadDocuments();
        });
      }
    );
  });
});

// Simple substring search across title, url and text
function searchDocs(query) {
  const q = query.toLowerCase();
  return docs.filter((doc) => {
    return (
      (doc.title && doc.title.toLowerCase().includes(q)) ||
      (doc.url && doc.url.toLowerCase().includes(q)) ||
      (doc.text && doc.text.toLowerCase().includes(q))
    );
  });
}

// Listen for search queries
searchInput.addEventListener('input', () => {
  const query = searchInput.value.trim();
  if (!query) {
    renderResults(docs);
    return;
  }
  const results = searchDocs(query);
  renderResults(results);
});

// Initial load of documents when popup opens
loadDocuments();
