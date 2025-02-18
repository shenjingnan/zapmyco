import { Button } from "@/components/ui/button";
import LightbulbCard from "@/components/devices/LightbulbCard";
import { Card, CardContent } from "@/components/ui/card";

import { Camera } from "lucide-react";
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
import { useState } from "react";
import { useLifecycles } from "react-use";
import LightCard from "./components/devices/LightCard";

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
  };

  return (
    <div>
      <div className="grid grid-cols-12 gap-4 p-4">
        {Object.keys(entities).map((entityId) =>
          ["switch", "light", "input_boolean"].includes(
            entityId.split(".", 1)[0]
          ) ? (
            <LightCard key={entityId} entity={entities[entityId]} />
          ) : (
            <Card key={entityId}>
              <CardContent>
                {entityId}
                 {/* {entities[entityId].state}{" "} */}
                {/* {entities[entityId].attributes.friendly_name} */}
              </CardContent>
            </Card>
          )
        )}
      </div>
      <pre>{JSON.stringify(entities, null, 2)}</pre>
    </div>
  );
}

export default App;
