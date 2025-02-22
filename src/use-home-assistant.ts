import {
  HassEntities,
  Connection,
  getAuth,
  getUser,
  subscribeEntities,
  createConnection,
  ERR_HASS_HOST_REQUIRED,
  callService,
} from 'home-assistant-js-websocket';
import { create } from 'zustand';

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
  alert(`Failed to authenticate: ${error}`);
  return null;
};

const useHomeAssistant = create<{
  entities: HassEntities;
  connection: Connection | null;
  init: () => Promise<void>;
  toggleLight: (entityId: string) => Promise<void>;
}>((set, get) => ({
  entities: {},
  connection: null,
  init: async () => {
    const auth = await getAuth({
      loadTokens() {
        return parseJson(localStorage.hassTokens, undefined);
      },
      saveTokens: (tokens: unknown) => {
        localStorage.hassTokens = JSON.stringify(tokens);
      },
    }).catch(handleAuthError);

    if (!auth) return;
    const connection = await createConnection({ auth });
    if (location.search.includes('auth_callback=1')) {
      history.replaceState(null, '', location.pathname);
    }

    const user = await getUser(connection);
    console.log('Logged in as', user);
    subscribeEntities(connection, (entities: HassEntities) => {
      set({ entities });
      return () => {};
    });

    set({ connection });
  },
  toggleLight: async (entityId: string) => {
    const connection = get().connection;
    if (!connection) return;
    await callService(connection, 'homeassistant', 'toggle', {
      entity_id: entityId,
    });
  },
}));

export { useHomeAssistant };
