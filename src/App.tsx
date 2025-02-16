import { Button } from "@/components/ui/button"
import {
  getAuth,
  getUser,
  callService,
  createConnection,
  subscribeEntities,
  ERR_HASS_HOST_REQUIRED,
  type HassEntities,
  Connection,
} from "home-assistant-js-websocket";
import { useState, useEffect } from "react";
import { useLifecycles } from "react-use";

const parseJson = (str: string, defaultValue: unknown) => {
  try {
    return JSON.parse(str);
  } catch (err) {
    return defaultValue;
  }
};

const handleAuthError = async (error: unknown) => {
  if (error === ERR_HASS_HOST_REQUIRED) {
    const hassUrl = prompt("What host to connect to?", "http://localhost:8123");
    if (!hassUrl) return null;
    return await getAuth({ hassUrl });
  }

  console.error("Authentication error:", error);
  alert(`Failed to authenticate: ${error}`);
  return null;
};

function App() {
  const [entities, setEntities] = useState<HassEntities>({});
  const [connection, setConnection] = useState<Connection | null>(null);
  
  useLifecycles(() => {
    async function initConnection() {
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
      if (location.search.includes("auth_callback=1")) {
        history.replaceState(null, "", location.pathname);
      }

      const user = await getUser(connection);
      console.log("Logged in as", user);
      subscribeEntities(connection, (entities: HassEntities) => {
        setEntities(entities);
        return () => {};
      });

      setConnection(connection);
    }

    initConnection();
  });

  const toggleLight = (entity: string) => {
    if (!connection) return;
    callService(connection, "homeassistant", "toggle", {
      entity_id: entity,
    });
  }

  return (
    <div>
      <ul>
        {Object.keys(entities).map((entity) => (
            <li key={entity}>
              {entity} {entities[entity].state} {entities[entity].attributes.friendly_name}
              {["switch", "light", "input_boolean"].includes(entity.split(".", 1)[0]) && (
                <Button onClick={() => toggleLight(entity)}>Click me</Button>
              )}
            </li>
        ))}
      </ul>
      <pre>{JSON.stringify(entities, null, 2)}</pre>
    </div>
  )
}

export default App
