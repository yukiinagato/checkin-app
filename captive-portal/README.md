# Check-in captive portal

This independent, dependency-free Node service is the public room-rules page
for the guest Wi-Fi. It implements the remote Forward Authentication Service
(FAS) protocol used by openNDS security level 4.

The portal has no third-party assets or API calls. Before a guest accepts the
rules, the router only permits DNS plus HTTPS to
`checkin-kawachinagano.ox.gy`. After acceptance, the service adds a short-lived
authorisation request to a private queue. The router polls that queue and
unlocks only the matching device. The browser reports success only after
authmon confirms that `ndsctl` authenticated that exact response HID; queue
cleanup by itself is never treated as success. If registration is already
complete, the portal returns to the original HTTP connectivity-check URL. This
closes a healthy captive assistant, or starts a fresh portal session if the
device changed its private MAC/IP.

After the router confirms access, the portal reads the local check-in database
in read-only mode. If an accepted Hostex stay is active in Japan time and its
linked registration contains fewer non-deleted guests than the reservation's
adult-plus-child count, the selected-language page guides the guest to the
check-in form. When exactly one active reservation is incomplete, the button
contains its reservation code so the check-in app can open and prefill that
booking directly. If upstream data unexpectedly contains multiple incomplete
active stays, the portal uses the generic check-in URL rather than guessing.
Database lookup failures fail open and never block internet access.

The service is intentionally separate from the existing check-in Node process:
deploying it does not restart or release unrelated work in that application.

## Deployment files

- `server.js`: portal and FAS implementation
- `checkin-captive-portal.service`: systemd unit for `ox-webserver`
- `checkin-captive-portal.env.example`: environment file template
- `opennds-guest.conf.example`: staged router configuration
- `guest-captive-ipv6.nft`: VLAN 50 pre-authentication and authenticated IPv6 policy
- `checkin-ipv6-auth.sh`: BinAuth set updates and periodic state reconciliation
- `checkin-ipv6-auth-sync.init`: procd service for automatic reconciliation

The `FAS_KEY` is a secret shared only between this server and the router. Do
not commit or log it.

On the current router, dnsmasq intentionally listens on port 5354. The guest
firewall therefore redirects DNS requests from port 53 to that local port, and
openNDS explicitly permits the local resolver. This lets guests resolve the
portal hostname without granting pre-authentication access to external DNS.

The stock openNDS startup script must not be used unchanged on this router: it
sets `network.wan6.proto=none` and reloads all networking. The included init
override does not modify WAN6. While the portal is active, a narrow nftables
chain applies only to `eth0.50`. Before authentication it allows the configured
IPv6 DNS resolvers and the portal's dynamically resolved IPv6 addresses; all
other guest IPv6 forwarding is rejected. BinAuth mirrors each authenticated
MAC into the IPv6 allow set, and `checkin-ipv6-auth-sync.init` continuously
reconciles that set with openNDS so a later firewall reload heals automatically.
WAN6, VLAN 60 and sing-box are not modified.
