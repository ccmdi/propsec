export function getViolationIcon(type: string): string {
    switch (type) {
        case "missing_required":
            return "!";
        case "missing_warned":
            return "*";
        case "type_mismatch":
        case "type_mismatch_warned":
            return "~";
        case "unknown_field":
            return "?";
        default:
            return "-";
    }
}