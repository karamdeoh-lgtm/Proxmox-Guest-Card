/**
 * Proxmox Guest Card
 * A compact Lovelace card for a single Proxmox VE guest (VM or LXC),
 * built for the "Proxmox VE" (proxmoxve) Home Assistant integration.
 *
 * Shows: status, node, uptime, CPU/RAM/Disk usage (with raw GB where
 * available), and Start/Stop/Reboot actions.
 *
 * Author: Karam Harricharan
 * License: MIT
 */
class ProxmoxGuestCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }
  setConfig(config) {
    if (!config.entity) {
      throw new Error('You need to define an entity (the guest status sensor, e.g. binary_sensor.lxc_plex_101_status)');
    }
    if (!/^binary_sensor\.[a-z0-9_]+_status$/.test(config.entity)) {
      throw new Error('entity must be a binary_sensor guest status entity ending in _status');
    }
    if (config.metrics_source && !['proxmox', 'beszel'].includes(config.metrics_source)) {
      throw new Error('metrics_source must be proxmox or beszel');
    }
    this.config = { ...config };
    if (this._hass) this.hass = this._hass;
  }

  _deriveEntity(suffix) {
    const base = this.config.entity.replace('binary_sensor.', 'sensor.').replace(/_status$/, '');
    return base + suffix;
  }

  _deriveButton(suffix) {
    const base = this.config.entity.replace('binary_sensor.', 'button.').replace(/_status$/, '');
    return base + suffix;
  }

  _number(state) {
    if (!state || typeof state.state !== 'string' || !state.state.trim()) return null;
    const value = Number(state.state);
    return Number.isFinite(value) && value >= 0 ? value : null;
  }

  _sizeGB(state) {
    const value = this._number(state);
    const factors = { B: 1e-9, kB: 1e-6, KB: 1e-6, MB: 1e-3, GB: 1,
      TB: 1e3, KiB: 1024 / 1e9, MiB: 1024 ** 2 / 1e9,
      GiB: 1024 ** 3 / 1e9, TiB: 1024 ** 4 / 1e9 };
    const factor = factors[state?.attributes?.unit_of_measurement];
    return value !== null && factor !== undefined ? value * factor : null;
  }

  _metric(kind, suffixes) {
    const states = this._hass.states;
    const beszel = this.config.metrics_source === 'beszel';
    const mapping = beszel ? (this.config.beszel || {}) : this.config;
    const percentId = mapping[`${kind}_entity`] || (!beszel ? this._deriveEntity(suffixes[0]) : null);
    // Never combine an overridden percentage with unrelated auto-derived totals.
    const deriveRaw = !beszel && !mapping[`${kind}_entity`];
    const usedId = mapping[`${kind}_used_entity`] || (deriveRaw ? this._deriveEntity(suffixes[1]) : null);
    const totalId = mapping[`${kind}_total_entity`] || (deriveRaw ? this._deriveEntity(suffixes[2]) : null);
    let percent = this._number(states[percentId]);
    if (states[percentId]?.attributes?.unit_of_measurement !== '%') percent = null;
    const used = this._sizeGB(states[usedId]);
    const total = this._sizeGB(states[totalId]);
    if (percent === null && used !== null && total > 0 && used <= total) percent = used / total * 100;
    return { percent, used: total > 0 && used !== null && used <= total ? used : null, total };
  }

  _fmtGB(value) {
    if (value === null || value === undefined || isNaN(value)) return null;
    return value >= 10 ? value.toFixed(1) : value.toFixed(2);
  }

  _gauge(label, value, color, usedGB, totalGB) {
    const hasValue = value !== null && value !== undefined && !isNaN(value);
    const v = hasValue ? Math.min(100, Math.max(0, value)) : 0;
    const displayColor = v > 90 ? '#f87171' : v > 70 ? '#fbbf24' : color;
    const usedFmt = this._fmtGB(usedGB);
    const totalFmt = this._fmtGB(totalGB);
    const rawText = (usedFmt !== null && totalFmt !== null) ? `${usedFmt} / ${totalFmt} GB` : '';
    return `
      <div class="gauge-wrap">
        <div class="gauge-label">${label}</div>
        <div class="gauge-track">
          <div class="gauge-fill" style="width:${v}%; background:${displayColor}"></div>
        </div>
        <div class="gauge-value">${hasValue ? v.toFixed(1) + '%' : 'N/A'}</div>
        ${rawText ? `<div class="gauge-raw">${rawText}</div>` : ''}
      </div>
    `;
  }

  _relativeTime(isoString) {
    if (!isoString) return null;
    const then = new Date(isoString).getTime();
    if (!Number.isFinite(then) || then > Date.now()) return null;
    const diffSec = Math.floor((Date.now() - then) / 1000);
    if (diffSec < 60) return 'just now';
    const mins = Math.floor(diffSec / 60);
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    return `${days}d`;
  }

  _nodeColor(node) {
    if (!node) return '#6b7280';
    let hash = 0;
    for (let i = 0; i < node.length; i++) hash = node.charCodeAt(i) + ((hash << 5) - hash);
    const hue = Math.abs(hash) % 360;
    return `hsl(${hue}, 55%, 55%)`;
  }

  async _callButton(entityId, action) {
    const state = this._hass?.states[this.config.entity]?.state;
    const target = this._hass?.states[entityId];
    if (this._busy || !['on', 'off'].includes(state) || !target ||
        ['unavailable', 'unknown'].includes(target.state)) return;
    if ((action === 'start') !== (state === 'off')) return;
    if (action !== 'start' && this.config.confirm_actions !== false &&
        !window.confirm(`${action === 'stop' ? 'Stop' : 'Reboot'} ${this.config.name || this.config.entity}?`)) return;
    this._busy = true;
    this._actionError = '';
    this.hass = this._hass;
    try {
      await this._hass.callService('button', 'press', { entity_id: entityId });
    } catch (error) {
      this._actionError = `Action failed: ${error?.message || 'Home Assistant rejected the request'}`;
    } finally {
      this._busy = false;
      this.hass = this._hass;
    }
  }

  set hass(hass) {
    this._hass = hass;
    if (!this.config) return;
    if (!this.content) {
      this.shadowRoot.innerHTML = `
        <ha-card>
          <style>
            .action-btn:disabled { opacity: .45; cursor: not-allowed; }
            .action-error { color: var(--error-color, #f87171); font-size: .8rem; }
            ha-card { padding: 16px; display: flex; flex-direction: column; gap: 12px; border-left: 3px solid var(--divider-color, #333); transition: border-color 0.3s ease; }
            .header { display: flex; align-items: center; gap: 8px; }
            .status-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; box-shadow: 0 0 6px currentColor; }
            .name { font-size: 1.05rem; font-weight: 600; color: var(--primary-text-color); flex: 1; }
            .badge { font-size: 0.7rem; padding: 2px 8px; border-radius: 10px; background: var(--secondary-background-color, #333); color: var(--secondary-text-color); text-transform: uppercase; letter-spacing: 0.05em; }
            .node-badge { font-size: 0.7rem; padding: 2px 8px; border-radius: 10px; color: #fff; font-weight: 600; }
            .meta-row { display: flex; gap: 14px; font-size: 0.75rem; color: var(--secondary-text-color); margin-top: -6px; }
            .meta-row span { display: flex; align-items: center; gap: 4px; }
            .gauges { display: flex; gap: 14px; }
            .gauge-wrap { flex: 1; display: flex; flex-direction: column; gap: 4px; }
            .gauge-label { font-size: 0.7rem; color: var(--secondary-text-color); text-transform: uppercase; letter-spacing: 0.03em; }
            .gauge-track { height: 6px; border-radius: 3px; background: var(--divider-color, #333); overflow: hidden; }
            .gauge-fill { height: 100%; border-radius: 3px; transition: width 0.3s ease; }
            .gauge-value { font-size: 0.85rem; font-weight: 600; color: var(--primary-text-color); }
            .gauge-raw { font-size: 0.68rem; color: var(--secondary-text-color); }
            .card-content { cursor: pointer; }
            .actions { display: flex; gap: 8px; margin-top: 4px; }
            .action-btn { flex: 1; display: flex; align-items: center; justify-content: center; gap: 4px; padding: 6px 0; border-radius: 8px; background: var(--secondary-background-color, #2a2a2a); color: var(--primary-text-color); font-size: 0.75rem; font-weight: 500; cursor: pointer; border: 1px solid var(--divider-color, #3a3a3a); transition: background 0.15s ease; }
            .action-btn:hover { background: var(--divider-color, #3a3a3a); }
            .action-btn.danger:hover { background: #7f1d1d; border-color: #f87171; }
            .action-btn ha-icon { --mdc-icon-size: 16px; }
          </style>
          <div class="card-content">
            <div class="header">
              <div class="status-dot"></div>
              <div class="name"></div>
              <div class="badge type-badge"></div>
            </div>
            <div class="meta-row">
              <span class="node-badge-wrap"></span>
              <span class="uptime-info"></span>
            </div>
            <div class="gauges"></div>
            <div class="actions"></div>
            <div class="action-error" role="alert"></div>
          </div>
        </ha-card>
      `;
      this.content = this.shadowRoot.querySelector('.card-content');
      this.card = this.shadowRoot.querySelector('ha-card');
      this.content.addEventListener('click', (e) => {
        if (e.target.closest('.actions')) return;
        const event = new Event('hass-more-info', { bubbles: true, composed: true });
        event.detail = { entityId: this.config.entity };
        this.dispatchEvent(event);
      });
    }

    const statusState = hass.states[this.config.entity];
    const cpuEntity = this.config.cpu_entity || this._deriveEntity('_cpu_used');
    const ramEntity = this.config.ram_entity || this._deriveEntity('_memory_used_percentage');
    const diskEntity = this.config.disk_entity || this._deriveEntity('_disk_used_percentage');
    const ramUsedEntity = this._deriveEntity('_memory_used');
    const ramTotalEntity = this._deriveEntity('_memory_total');
    const diskUsedEntity = this._deriveEntity('_disk_used');
    const diskTotalEntity = this._deriveEntity('_disk_total');
    const nodeEntity = this._deriveEntity('_node');
    const bootEntity = this._deriveEntity('_last_boot');

    const cpuState = hass.states[cpuEntity];
    const ramState = hass.states[ramEntity];
    const diskState = hass.states[diskEntity];
    const ramUsedState = hass.states[ramUsedEntity];
    const ramTotalState = hass.states[ramTotalEntity];
    const diskUsedState = hass.states[diskUsedEntity];
    const diskTotalState = hass.states[diskTotalEntity];
    const nodeState = hass.states[nodeEntity];
    const bootState = hass.states[bootEntity];

    const statusKnown = ['on', 'off'].includes(statusState?.state);
    const isRunning = statusState?.state === 'on';
    const defaultName = statusState && statusState.attributes.friendly_name
      ? statusState.attributes.friendly_name.replace(' Status', '')
      : this.config.entity;
    const name = this.config.name || defaultName;
    const isLxc = this.config.entity.includes('lxc_');

    const dot = this.shadowRoot.querySelector('.status-dot');
    dot.style.background = !statusKnown ? '#9ca3af' : isRunning ? '#4ade80' : '#f87171';
    dot.style.color = !statusKnown ? '#9ca3af' : isRunning ? '#4ade80' : '#f87171';
    this.shadowRoot.querySelector('.name').textContent = name;
    this.shadowRoot.querySelector('.type-badge').textContent = isLxc ? 'LXC' : 'VM';

    const ram = this._metric('ram', ['_memory_used_percentage', '_memory_used', '_memory_total']);
    const disk = this._metric('disk', ['_disk_used_percentage', '_disk_used', '_disk_total']);
    const cpuId = this.config.metrics_source === 'beszel' ? this.config.beszel?.cpu_entity : cpuEntity;
    const cpu = hass.states[cpuId];
    const cpuVal = cpu?.attributes?.unit_of_measurement === '%' ? this._number(cpu) : null;
    const ramVal = ram.percent, diskVal = disk.percent;
    const ramUsedVal = ram.used, ramTotalVal = ram.total;
    const diskUsedVal = disk.used, diskTotalVal = disk.total;

    const maxVal = Math.max(cpuVal || 0, ramVal || 0, diskVal || 0);
    this.card.style.borderLeftColor = !statusKnown ? '#9ca3af' : !isRunning ? '#f87171' : maxVal > 90 ? '#f87171' : maxVal > 70 ? '#fbbf24' : '#4ade80';

    const nodeName = nodeState && nodeState.state && nodeState.state !== 'unavailable' && nodeState.state !== 'unknown' ? nodeState.state : null;
    const nodeBadgeWrap = this.shadowRoot.querySelector('.node-badge-wrap');
    nodeBadgeWrap.innerHTML = nodeName
      ? `<span class="node-badge" style="background:${this._nodeColor(nodeName)}"></span>`
      : '';

    if (nodeName) nodeBadgeWrap.querySelector('.node-badge').textContent = nodeName;

    const uptimeRel = bootState ? this._relativeTime(bootState.state) : null;
    const uptimeText = !statusKnown ? 'Status unavailable' : isRunning && uptimeRel ? `\u23F1\uFE0F up ${uptimeRel}` : (!isRunning ? 'stopped' : '');
    this.shadowRoot.querySelector('.uptime-info').textContent = `${uptimeText} · ${this.config.metrics_source === 'beszel' ? 'Beszel' : 'Proxmox'}`;

    this.shadowRoot.querySelector('.gauges').innerHTML =
      this._gauge('CPU', cpuVal, '#60a5fa') +
      this._gauge('RAM', ramVal, '#a78bfa', ramUsedVal, ramTotalVal) +
      (this.config.show_disk !== false ? this._gauge('Disk', diskVal, '#34d399', diskUsedVal, diskTotalVal) : '');

    this.shadowRoot.querySelector('.action-error').textContent = this._actionError || '';
    if (this.config.show_actions !== false && statusKnown) {
      const startBtn = this._deriveButton('_start');
      const stopBtn = this._deriveButton('_stop');
      const rebootBtn = this._deriveButton('_reboot');
      const actionsEl = this.shadowRoot.querySelector('.actions');
      actionsEl.innerHTML = isRunning
        ? `<button type="button" class="action-btn" data-action="reboot"><ha-icon icon="mdi:restart"></ha-icon>Reboot</button>
           <button type="button" class="action-btn danger" data-action="stop"><ha-icon icon="mdi:stop"></ha-icon>Stop</button>`
        : `<button type="button" class="action-btn" data-action="start"><ha-icon icon="mdi:play"></ha-icon>Start</button>`;
      actionsEl.querySelectorAll('.action-btn').forEach((btn) => {
        const targetId = { start: startBtn, stop: stopBtn, reboot: rebootBtn }[btn.dataset.action];
        const targetState = hass.states[targetId];
        btn.disabled = !!this._busy || !targetState || ['unknown', 'unavailable'].includes(targetState.state);
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const action = btn.dataset.action;
          if (action === 'start') this._callButton(startBtn, 'start');
          if (action === 'stop') this._callButton(stopBtn, 'stop');
          if (action === 'reboot') this._callButton(rebootBtn, 'reboot');
        });
      });
    } else {
      this.shadowRoot.querySelector('.actions').innerHTML = '';
    }
  }

  getCardSize() {
    return 3;
  }

  static getStubConfig() {
    return { entity: '' };
  }
}

customElements.define('proxmox-guest-card', ProxmoxGuestCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: 'proxmox-guest-card',
  name: 'Proxmox Guest Card',
  description: 'Compact status/CPU/RAM/Disk card for a Proxmox VE guest (VM or LXC), with color-coded node badge, uptime, raw GB usage, and start/stop/reboot actions',
});
