import { privateRouteDisabled } from "@/lib/site-mode";
import { handlers } from "@/auth";
export function GET(request: Parameters<typeof handlers.GET>[0]) {
  return privateRouteDisabled() ?? handlers.GET(request);
}
export function POST(request: Parameters<typeof handlers.POST>[0]) {
  return privateRouteDisabled() ?? handlers.POST(request);
}
