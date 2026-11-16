import { createFileRoute } from "@tanstack/react-router";
import { Guide } from "@/components/site/guide";

export const Route = createFileRoute("/guide")({
  component: Guide,
});
