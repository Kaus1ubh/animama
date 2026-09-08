import { startLocalGateway } from "./start-local-gateway.js";

// This listener is reachable only on the Compose bridge network. The sole
// host mapping is pinned separately to 127.0.0.1 in docker-compose.yml.
void startLocalGateway("0.0.0.0");
