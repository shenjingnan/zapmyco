import { Card, CardContent } from "@/components/ui/card";
import { HassEntity } from "home-assistant-js-websocket";
import { Lightbulb as LightbulbIcon } from "lucide-react";

type LightbulbCardProps = {
  entity: HassEntity;
  size: "small" | "normal" | "large";
};

function LightbulbCard(props: Readonly<LightbulbCardProps>) {
  return (
    <Card className="col-span-1 flex flex-col">
      <CardContent className="flex items-center gap-2 p-2">
        <LightbulbIcon />
        <p className="truncate flex-1">{props.entity.attributes.friendly_name}</p>
      </CardContent>
    </Card>
  );
}

export default LightbulbCard;
