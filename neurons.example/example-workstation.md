---
neuron_id: example-workstation
display_name: Example Workstation
entity_type: component
source_system: macos
boundary: example-lab
discovery_method: manual
confidence_score: 1.0
edges:
  - target: example-ap
    type: connects
    weight: 0.7
---

Example developer workstation.

- LAN: 192.0.2.42
- Connection: Wi-Fi via example-ap
