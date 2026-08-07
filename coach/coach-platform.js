// Stable extension contract for Fuel Guard Coach feature modules.
(function attachCoachPlatform(root, factory) {
  const createCoachPlatform = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = createCoachPlatform;
  if (!root?.document) return;

  const instance = createCoachPlatform({ root, document: root.document });
  root.FuelGuardCoachPlatform = instance.api;
  root.FuelGuardCoachPlatformBridge = instance.bridge;
})(typeof globalThis !== "undefined" ? globalThis : this, function createCoachPlatformFactory() {
  const VERSION = "1.0.0";
  const EVENTS = Object.freeze({
    DATA_LOADED: "coach-data-loaded",
    DATA_REFRESHED: "coach-data-refreshed",
    ATHLETE_SELECTED: "athlete-selected"
  });
  const EVENT_NAMES = new Set(Object.values(EVENTS));
  const FEATURE_HOSTS = new Set(["dashboard", "athletes", "reports", "settings"]);
  const FILTER_OPERATORS = new Set([
    "eq",
    "neq",
    "gt",
    "gte",
    "lt",
    "lte",
    "like",
    "ilike",
    "is",
    "in",
    "contains",
    "containedBy",
    "overlaps"
  ]);
  const PRIVATE_KEYS = new Set([
    "access_token",
    "refresh_token",
    "provider_token",
    "provider_refresh_token",
    "anonKey",
    "serviceRoleKey",
    "service_role_key",
    "password"
  ]);

  function clonePublic(value, seen = new WeakMap()) {
    if (value === null || value === undefined || typeof value !== "object") return value;
    if (value instanceof Date) return new Date(value.getTime());
    if (seen.has(value)) return seen.get(value);

    if (Array.isArray(value)) {
      const copy = [];
      seen.set(value, copy);
      value.forEach(item => copy.push(clonePublic(item, seen)));
      return copy;
    }

    const copy = {};
    seen.set(value, copy);
    Object.keys(value).forEach(key => {
      if (!PRIVATE_KEYS.has(key)) copy[key] = clonePublic(value[key], seen);
    });
    return copy;
  }

  function deepFreeze(value, seen = new WeakSet()) {
    if (!value || typeof value !== "object" || seen.has(value)) return value;
    seen.add(value);
    Object.values(value).forEach(item => deepFreeze(item, seen));
    return Object.freeze(value);
  }

  function immutable(value) {
    return deepFreeze(clonePublic(value));
  }

  function validIdentifier(value, label) {
    const identifier = String(value || "");
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
      throw new Error(`${label} must be a simple database identifier.`);
    }
    return identifier;
  }

  function createCoachPlatform({ root = globalThis, document = root?.document } = {}) {
    let adapters = null;
    let connected = false;
    let loaded = false;
    let revision = 0;
    let featureSequence = 0;
    let renderQueued = false;
    let refreshInFlight = null;
    const listeners = new Map();
    const features = new Map();

    function sourceState() {
      return adapters?.readState?.() || {};
    }

    function coachIdentity(source) {
      const user = source?.session?.user || source?.coach || null;
      if (!user?.id) return null;
      return {
        id: String(user.id),
        email: user.email ? String(user.email) : ""
      };
    }

    function publicState() {
      const source = sourceState();
      const coach = coachIdentity(source);
      if (!coach) {
        return immutable({
          revision,
          loaded: false,
          coach: null,
          coachProfile: null,
          relationships: [],
          roster: [],
          athleteProfiles: [],
          logs: [],
          targets: [],
          reports: [],
          interventions: [],
          selectedAthleteId: ""
        });
      }

      return immutable({
        revision,
        loaded,
        coach,
        coachProfile: source.profile || null,
        relationships: source.relationships || [],
        roster: source.roster || [],
        athleteProfiles: source.athleteProfiles || [],
        logs: source.logs || [],
        targets: source.targets || [],
        reports: source.reports || [],
        interventions: source.interventions || [],
        selectedAthleteId: String(source.selectedAthleteId || "")
      });
    }

    function selectedAthlete() {
      const snapshot = publicState();
      return snapshot.roster.find(item => String(item?.athlete?.userId || "") === snapshot.selectedAthleteId) || null;
    }

    function dispatch(name, detail) {
      const safeDetail = immutable(detail);
      (listeners.get(name) || new Set()).forEach(listener => {
        try {
          listener(safeDetail);
        } catch (error) {
          root?.console?.error?.(`Fuel Guard Coach listener failed for ${name}.`, error);
        }
      });
      if (document?.dispatchEvent && root?.CustomEvent) {
        document.dispatchEvent(new root.CustomEvent(name, { detail: safeDetail }));
      }
    }

    function on(name, listener) {
      if (!EVENT_NAMES.has(name)) throw new Error(`Unknown Coach platform event: ${name}`);
      if (typeof listener !== "function") throw new Error("Coach platform listeners must be functions.");
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(listener);
      return () => listeners.get(name)?.delete(listener);
    }

    function activeClient() {
      if (!coachIdentity(sourceState())) throw new Error("Coach authentication is required for data access.");
      const client = adapters?.getClient?.();
      if (!client?.from || !client?.rpc) throw new Error("Coach data access is not configured yet.");
      return client;
    }

    function applyFilters(query, filters = []) {
      return filters.reduce((builder, filter) => {
        const operator = String(filter?.operator || "eq");
        if (!FILTER_OPERATORS.has(operator) || typeof builder?.[operator] !== "function") {
          throw new Error(`Unsupported Coach data filter: ${operator}`);
        }
        const column = validIdentifier(filter?.column, "Filter column");
        if (operator === "in" && !Array.isArray(filter?.value)) {
          throw new Error("The in filter requires an array value.");
        }
        return builder[operator](column, filter?.value);
      }, query);
    }

    function applyResultShape(query, options = {}) {
      let builder = query;
      const orders = Array.isArray(options.order) ? options.order : options.order ? [options.order] : [];
      orders.forEach(order => {
        builder = builder.order(validIdentifier(order.column, "Order column"), {
          ascending: order.ascending !== false,
          nullsFirst: Boolean(order.nullsFirst),
          foreignTable: order.foreignTable
        });
      });
      if (Number.isInteger(options.limit) && options.limit > 0) builder = builder.limit(options.limit);
      if (Array.isArray(options.range) && options.range.length === 2) builder = builder.range(options.range[0], options.range[1]);
      if (options.single) builder = builder.single();
      else if (options.maybeSingle) builder = builder.maybeSingle();
      return builder;
    }

    async function select(table, options = {}) {
      const columns = typeof options.columns === "string" && options.columns.trim() ? options.columns : "*";
      let query = activeClient()
        .from(validIdentifier(table, "Table"))
        .select(columns, { count: options.count, head: Boolean(options.head) });
      query = applyFilters(query, options.filters);
      return applyResultShape(query, options);
    }

    async function insert(table, values, options = {}) {
      let query = activeClient().from(validIdentifier(table, "Table")).insert(values);
      if (options.select) query = query.select(options.select === true ? "*" : options.select);
      return applyResultShape(query, options);
    }

    async function update(table, values, options = {}) {
      if (!Array.isArray(options.filters) || !options.filters.length) {
        throw new Error("Coach data updates require at least one filter.");
      }
      let query = activeClient().from(validIdentifier(table, "Table")).update(values);
      query = applyFilters(query, options.filters);
      if (options.select) query = query.select(options.select === true ? "*" : options.select);
      return applyResultShape(query, options);
    }

    async function upsert(table, values, options = {}) {
      let query = activeClient().from(validIdentifier(table, "Table")).upsert(values, {
        onConflict: options.onConflict,
        ignoreDuplicates: Boolean(options.ignoreDuplicates)
      });
      if (options.select) query = query.select(options.select === true ? "*" : options.select);
      return applyResultShape(query, options);
    }

    async function remove(table, options = {}) {
      if (!Array.isArray(options.filters) || !options.filters.length) {
        throw new Error("Coach data deletes require at least one filter.");
      }
      let query = activeClient().from(validIdentifier(table, "Table")).delete();
      query = applyFilters(query, options.filters);
      if (options.select) query = query.select(options.select === true ? "*" : options.select);
      return applyResultShape(query, options);
    }

    async function rpc(name, args = {}, options = {}) {
      return activeClient().rpc(validIdentifier(name, "RPC"), args, options);
    }

    const data = Object.freeze({ select, insert, update, upsert, remove, rpc });

    function featureContainer(feature) {
      const host = document?.querySelector?.(`[data-coach-feature-host="${feature.host}"]`);
      if (!host) return null;
      let container = host.querySelector?.(`[data-coach-feature="${feature.id}"]`) || null;
      if (!container) {
        container = (host.ownerDocument || document).createElement("section");
        container.className = "coach-feature";
        container.dataset.coachFeature = feature.id;
      }
      host.appendChild(container);
      return container;
    }

    function orderedFeatures() {
      return [...features.values()].sort((left, right) => left.order - right.order || left.sequence - right.sequence);
    }

    function renderFeatures() {
      renderQueued = false;
      const snapshot = publicState();
      orderedFeatures().forEach(feature => {
        if (typeof feature.render !== "function") return;
        const container = featureContainer(feature);
        if (!container) return;
        try {
          feature.render(Object.freeze({ container, state: snapshot, platform: api }));
        } catch (error) {
          root?.console?.error?.(`Fuel Guard Coach feature failed: ${feature.id}.`, error);
        }
      });
    }

    function queueFeatureRender() {
      if (renderQueued) return;
      renderQueued = true;
      if (typeof root?.queueMicrotask === "function") root.queueMicrotask(renderFeatures);
      else Promise.resolve().then(renderFeatures);
    }

    function registerFeature({ id, host, order = 1000, render } = {}) {
      const featureId = String(id || "");
      if (!/^[a-z][a-z0-9-]*$/.test(featureId)) throw new Error("Coach feature ids must use kebab-case.");
      if (!FEATURE_HOSTS.has(host)) throw new Error(`Unknown Coach feature host: ${host}`);
      if (features.has(featureId)) throw new Error(`Coach feature already registered: ${featureId}`);
      if (render !== undefined && typeof render !== "function") throw new Error("Coach feature render must be a function.");
      const feature = {
        id: featureId,
        host,
        order: Number.isFinite(Number(order)) ? Number(order) : 1000,
        render,
        sequence: featureSequence++
      };
      features.set(featureId, feature);
      queueFeatureRender();
      return () => {
        features.delete(featureId);
        document?.querySelector?.(`[data-coach-feature="${featureId}"]`)?.remove?.();
      };
    }

    async function refresh(reason = "feature-request") {
      if (typeof adapters?.refresh !== "function") throw new Error("Coach refresh is not connected yet.");
      if (refreshInFlight) return refreshInFlight;
      refreshInFlight = Promise.resolve(adapters.refresh({ reason: String(reason || "feature-request") }))
        .finally(() => {
          refreshInFlight = null;
        });
      return refreshInFlight;
    }

    async function selectAthlete(athleteId) {
      const id = String(athleteId || "");
      const allowed = publicState().roster.some(item => String(item?.athlete?.userId || "") === id);
      if (!allowed || typeof adapters?.selectAthlete !== "function") return false;
      const selected = await adapters.selectAthlete(id);
      if (selected === false) return false;
      controller.athleteSelected(id);
      return true;
    }

    const api = Object.freeze({
      version: VERSION,
      events: EVENTS,
      data,
      getState: publicState,
      getSelectedAthlete: selectedAthlete,
      refresh,
      selectAthlete,
      on,
      registerFeature
    });

    const controller = Object.freeze({
      publishData(reason = "coach-data") {
        const name = loaded ? EVENTS.DATA_REFRESHED : EVENTS.DATA_LOADED;
        loaded = true;
        revision += 1;
        renderFeatures();
        dispatch(name, { reason: String(reason || "coach-data"), state: publicState() });
      },
      athleteSelected(athleteId) {
        renderFeatures();
        dispatch(EVENTS.ATHLETE_SELECTED, {
          athleteId: String(athleteId || ""),
          athlete: selectedAthlete(),
          state: publicState()
        });
      },
      renderFeatures,
      reset() {
        loaded = false;
        revision += 1;
        renderFeatures();
      }
    });

    const bridge = Object.freeze({
      connect(nextAdapters = {}) {
        if (connected) throw new Error("Coach platform is already connected.");
        if (typeof nextAdapters.readState !== "function") throw new Error("Coach platform requires a state reader.");
        adapters = Object.freeze({ ...nextAdapters });
        connected = true;
        return controller;
      }
    });

    return Object.freeze({ api, bridge });
  }

  return createCoachPlatform;
});
