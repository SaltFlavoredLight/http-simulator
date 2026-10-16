const status = document.querySelector('#status');
const log = document.querySelector('#log');
const stateView = document.querySelector('#builder-state');
const preview = document.querySelector('#preview');

let builderState = { page: 'home', lastAction: null };

function addLog(message) {
  const item = document.createElement('li');
  item.textContent = `${new Date().toLocaleTimeString()} — ${message}`;
  log.prepend(item);
}

function renderState() {
  stateView.textContent = JSON.stringify(builderState, null, 2);
}

navigator.serviceWorker.addEventListener('message', event => {
  const message = event.data;
  if (message?.source !== 'raysite-simulator') return;

  if (message.type === 'REQUEST_SIMULATED') {
    addLog(`${message.method} ${message.pathname} → simulated HTTP ${message.status}`);
  } else if (message.type === 'BUILDER_ACTION') {
    // Replace this demo reducer with your website builder's real state update.
    builderState = {
      ...builderState,
      page: message.action === 'publish' ? 'published' : builderState.page,
      lastAction: message.action
    };
    renderState();
    addLog(`Builder action received: ${message.action}`);
  }
});

async function boot() {
  if (!('serviceWorker' in navigator)) {
    status.textContent = 'Service workers are not supported by this browser.';
    return;
  }

  try {
    const registration = await navigator.serviceWorker.register('/simulator-sw.js', {
      scope: '/'
    });
    await navigator.serviceWorker.ready;

    if (!navigator.serviceWorker.controller) {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timed out waiting for service worker control. Reload once and try again.')), 8000);
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          clearTimeout(timeout);
          resolve();
        }, { once: true });
      });
    }

    status.textContent = `Service worker ready. Scope: ${registration.scope}. Reload once if this is the first visit.`;
    addLog('Service worker is controlling the builder page.');

    // Load/reload preview only after controller is active so its requests are intercepted.
    preview.src = '/preview.html';
  } catch (error) {
    status.textContent = `Could not start simulator: ${error.message}`;
    addLog(error.message);
  }
}

renderState();
boot();
