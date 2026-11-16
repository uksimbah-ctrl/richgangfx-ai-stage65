import { createFileRoute } from "@tanstack/react-router";
import { Callback } from "@/components/site/callback";

export const Route = createFileRoute("/callback")({
  component: Callback,
});
