import {
  HassEntities,
  Connection,
  getAuth,
  getUser,
  subscribeEntities,
  createConnection,
  ERR_HASS_HOST_REQUIRED,
  callService,
  HassEntity,
} from 'home-assistant-js-websocket';
import { create } from 'zustand';

interface HomeAssistantStore {
  entities: HassEntities;
  connection: Connection | null;
  connected: boolean;
  lastUpdated: number;
  error: string | null;
  init: () => Promise<(() => void) | void>;
  disconnect: () => void;
  toggleLight: (entityId: string) => Promise<void>;
  getEntityState: (entityId: string) => HassEntity | null;
}

const parseJson = (str: string, defaultValue: unknown) => {
  try {
    return JSON.parse(str);
  } catch (err) {
    console.error(err);
    return defaultValue;
  }
};

const handleAuthError = async (error: unknown) => {
  if (error === ERR_HASS_HOST_REQUIRED) {
    const hassUrl = prompt('What host to connect to?', 'http://localhost:8123');
    if (!hassUrl) return null;
    return await getAuth({ hassUrl });
  }

  console.error('Authentication error:', error);
  throw new Error(`Failed to authenticate: ${error}`);
};

const useHomeAssistant = create<HomeAssistantStore>((set, get) => ({
  entities: {},
  connection: null,
  connected: false,
  lastUpdated: 0,
  error: null,

  init: async () => {
    try {
      get().disconnect();

      const auth = await getAuth({
        loadTokens() {
          return parseJson(localStorage.hassTokens, undefined);
        },
        saveTokens: (tokens: unknown) => {
          localStorage.hassTokens = JSON.stringify(tokens);
        },
      }).catch(handleAuthError);

      if (!auth) {
        set({ error: 'Authentication failed' });
        return;
      }

      const connection = await createConnection({ auth });

      if (location.search.includes('auth_callback=1')) {
        history.replaceState(null, '', location.pathname);
      }

      const user = await getUser(connection);
      console.log('Logged in as', user);

      connection.addEventListener('ready', () => set({ connected: true }));
      connection.addEventListener('disconnected', () => set({ connected: false }));

      const unsubscribe = subscribeEntities(connection, (entities) => {
        set({
          entities,
          lastUpdated: Date.now(),
          error: null,
        });
      });

      set({
        connection,
        connected: true,
        error: null,
      });

      return () => {
        unsubscribe();
        connection.close();
      };
    } catch (error) {
      console.error('Failed to initialize Home Assistant connection:', error);
      set({
        error: error instanceof Error ? error.message : 'Unknown error',
        connected: false,
      });
    }
  },

  disconnect: () => {
    const { connection } = get();
    if (connection) {
      connection.close();
      set({
        connection: null,
        connected: false,
        entities: {},
      });
    }
  },

  toggleLight: async (entityId: string) => {
    const { connection } = get();
    if (!connection) {
      throw new Error('No connection to Home Assistant');
    }

    try {
      await callService(connection, 'homeassistant', 'toggle', {
        entity_id: entityId,
      });
    } catch (error) {
      console.error(`Failed to toggle light ${entityId}:`, error);
      throw error;
    }
  },

  getEntityState: (entityId: string) => {
    const { entities } = get();
    return entities[entityId] || null;
  },
}));

export { useHomeAssistant };
