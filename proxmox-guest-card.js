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
  setConfig(config) {
    if (!config.entity) {
      throw new Error('You need to define an entity (the guest status sensor, e.g. binary_sensor.lxc_plex_101_status)');
    }
    this.config = config;
  }

  _deriveEntity(suffix) {
    const base = this.config.entity.replace('binary_sensor.', 'sensor.').replace(/_status$/, '');
    return base + suffix;
  }

  _deriveButton(suffix) {
    const base = this.config.entity.replace('binary_sensor.', 'button.').replace(/_status$/, '');
    return base + suffix;
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
    if (isNaN(then)) return null;
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

  _callButton(entityId) {
    if (!this._hass || !entityId) return;
    this._hass.callService('button', 'press', { entity_id: entityId });
  }

  set hass(hass) {
    this._hass = hass;
    if (!this.content) {
      this.innerHTML = `
        <ha-card>
          <style>
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
          </div>
        </ha-card>
      `;
      this.content = this.querySelector('.card-content');
      this.card = this.querySelector('ha-card');
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

    const isRunning = statusState && statusState.state === 'on';
    const defaultName = statusState && statusState.attributes.friendly_name
      ? statusState.attributes.friendly_name.replace(' Status', '')
      : this.config.entity;
    const name = this.config.name || defaultName;
    const isLxc = this.config.entity.includes('lxc_');

    const dot = this.querySelector('.status-dot');
    dot.style.background = isRunning ? '#4ade80' : '#f87171';
    dot.style.color = isRunning ? '#4ade80' : '#f87171';
    this.querySelector('.name').textContent = name;
    this.querySelector('.type-badge').textContent = isLxc ? 'LXC' : 'VM';

    const cpuVal = cpuState ? parseFloat(cpuState.state) : null;
    const ramVal = ramState ? parseFloat(ramState.state) : null;
    const diskVal = diskState ? parseFloat(diskState.state) : null;
    const ramUsedVal = ramUsedState ? parseFloat(ramUsedState.state) : null;
    const ramTotalVal = ramTotalState ? parseFloat(ramTotalState.state) : null;
    const diskUsedVal = diskUsedState ? parseFloat(diskUsedState.state) : null;
    const diskTotalVal = diskTotalState ? parseFloat(diskTotalState.state) : null;

    const maxVal = Math.max(cpuVal || 0, ramVal || 0, diskVal || 0);
    this.card.style.borderLeftColor = !isRunning ? '#f87171' : maxVal > 90 ? '#f87171' : maxVal > 70 ? '#fbbf24' : '#4ade80';

    const nodeName = nodeState && nodeState.state && nodeState.state !== 'unavailable' && nodeState.state !== 'unknown' ? nodeState.state : null;
    const nodeBadgeWrap = this.querySelector('.node-badge-wrap');
    nodeBadgeWrap.innerHTML = nodeName
      ? `<span class="node-badge" style="background:${this._nodeColor(nodeName)}">${nodeName}</span>`
      : '';

    const uptimeRel = bootState ? this._relativeTime(bootState.state) : null;
    const uptimeText = isRunning && uptimeRel ? `\u23F1\uFE0F up ${uptimeRel}` : (!isRunning ? 'stopped' : '');
    this.querySelector('.uptime-info').textContent = uptimeText;

    this.querySelector('.gauges').innerHTML =
      this._gauge('CPU', cpuVal, '#60a5fa') +
      this._gauge('RAM', ramVal, '#a78bfa', ramUsedVal, ramTotalVal) +
      (this.config.show_disk !== false ? this._gauge('Disk', diskVal, '#34d399', diskUsedVal, diskTotalVal) : '');

    if (this.config.show_actions !== false) {
      const startBtn = this._deriveButton('_start');
      const stopBtn = this._deriveButton('_stop');
      const rebootBtn = this._deriveButton('_reboot');
      const actionsEl = this.querySelector('.actions');
      actionsEl.innerHTML = isRunning
        ? `<div class="action-btn" data-action="reboot"><ha-icon icon="mdi:restart"></ha-icon>Reboot</div>
           <div class="action-btn danger" data-action="stop"><ha-icon icon="mdi:stop"></ha-icon>Stop</div>`
        : `<div class="action-btn" data-action="start"><ha-icon icon="mdi:play"></ha-icon>Start</div>`;
      actionsEl.querySelectorAll('.action-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const action = btn.dataset.action;
          if (action === 'start') this._callButton(startBtn);
          if (action === 'stop') this._callButton(stopBtn);
          if (action === 'reboot') this._callButton(rebootBtn);
        });
      });
    } else {
      this.querySelector('.actions').innerHTML = '';
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
