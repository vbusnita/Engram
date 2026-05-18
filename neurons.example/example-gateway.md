---
neuron_id: example-gateway
display_name: Example Gateway
entity_type: network
source_system: unifi
boundary: example-lab
discovery_method: manual
confidence_score: 1.0
edges:
  - target: example-ap
    type: connects
    weight: 0.9
---

Example router / gateway. IPs in this file use the RFC 5737 documentation
range (192.0.2.0/24) so the seeded canvas never resembles a real network.

- LAN: 192.0.2.1/24
- WAN: handled by upstream

Replace with your own neurons; this file exists only so the canvas isn't
empty on first launch.
