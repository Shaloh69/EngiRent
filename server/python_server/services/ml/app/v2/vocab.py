"""
The vocabulary stage 2 asks CLIP to choose from.

Deliberately generic: what engineering students at UCLM plausibly rent or
leave in a locker by mistake, plus "nothing" classes. It is NOT tuned to the
evaluation items: a vocabulary that only works because it lists exactly the
test items would be an overfit that fails on the next listing.
"""

EQUIPMENT = [
    "screwdriver", "hammer", "rivet gun", "pliers", "wire stripper", "wrench",
    "adjustable spanner", "hex key set", "hand saw", "hacksaw", "utility knife",
    "scissors", "tape measure", "steel ruler", "vernier caliper", "micrometer",
    "spirit level", "try square", "clamp", "vise grip", "file", "chisel",
    "soldering iron", "desoldering pump", "hot glue gun", "heat gun",
    "power drill", "cordless drill", "angle grinder", "jigsaw", "sander",
    "multimeter", "clamp meter", "oscilloscope", "power supply", "function generator",
    "breadboard", "arduino board", "raspberry pi", "circuit board", "jumper wires",
    "extension cord", "cable", "battery pack", "charger", "flashlight", "headlamp",
    "calculator", "drafting compass", "t-square", "protractor", "triangle ruler",
    "drawing tablet", "laptop", "keyboard", "computer mouse", "webcam", "headphones",
    "safety goggles", "hard hat", "gloves", "lab coat", "tripod", "camera",
    "projector", "speaker", "microphone", "router", "tape roll", "roll of wire",
    "toolbox", "book", "notebook", "bottle", "phone",
]

NOTHING = [
    "an empty white shelf", "an empty locker", "a plastic bag", "a sheet of paper",
    "a piece of cloth", "a shadow",
]

VOCAB = EQUIPMENT + NOTHING


def prompt(label: str) -> str:
    return f"a photo of a {label}." if not label.startswith(("a ", "an ")) else f"a photo of {label}."
