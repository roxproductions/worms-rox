# Play alerts (phone push)

Players sign up on `alerts.html` (host it next to `index.html`, e.g. roxproductions.se/games/worms/alerts.html). It uses the free [ntfy](https://ntfy.sh) app, so there is no account, email or backend of your own to run.

## How it works
- The Cloudflare relay sends a push to ntfy when the first player joins a room (max one alert per game every 15 minutes).
- Topics (the "secret" players subscribe to): `worms-rox-alerts-91d49cdc` and `roxtown-alerts-91d49cdc`. Change them with the Worker variables `NTFY_TOPIC_WORMS` / `NTFY_TOPIC_GTA` and edit the two names at the top of the script in `alerts.html` to match (or open `alerts.html?w=TOPIC&g=TOPIC`).
- Redeploy the relay after updating: `cd relay/cloudflare && npx wrangler deploy`.

## RoxTown Carnage (GTA) hook
Call the relay once when a player connects to your Node server (the cooldown stops spam):

```js
fetch('https://worms-relay.roxgamez.workers.dev/notify?game=gta&name=' + encodeURIComponent(playerName)).catch(()=>{});
```
(Node 18+ has `fetch` built in.) Also add a link to `alerts.html` in the GTA menu.
