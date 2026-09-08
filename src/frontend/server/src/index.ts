import { resolveNativeGatewayBindHost } from "./local-bind.js";
import { startLocalGateway } from "./start-local-gateway.js";

void startLocalGateway(resolveNativeGatewayBindHost());
