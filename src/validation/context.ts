import { CustomType } from "../types";

/**
 * Global validation context
 */
class ValidationContext {
    private _customTypes: CustomType[] = [];

    get customTypes(): CustomType[] {
        return this._customTypes;
    }

    setCustomTypes(types: CustomType[]): void {
        this._customTypes = types;
    }

    getCustomType(name: string): CustomType | undefined {
        return this._customTypes.find(t => t.name === name);
    }
}

// Singleton instance
export const validationContext = new ValidationContext();
