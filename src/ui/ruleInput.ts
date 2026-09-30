import { AbstractInputSuggest, App } from "obsidian";
import { checkRule, completeRule, expandSnippet, helpersFor, type Completion, type RuleContext } from "@propsec/core";

export interface RuleInputOptions {
    context: RuleContext;
    value: string;
    onChange: (value: string) => void;
    /** Short result shown under a valid rule, e.g. how many notes it matches */
    preview?: (value: string) => string;
}

/**
 * A text box for one rule: completion on Ctrl+Space or while typing,
 * errors and warnings under the box, and an optional live preview.
 */
export function ruleInput(app: App, container: HTMLElement, options: RuleInputOptions): HTMLInputElement {
    const wrap = container.createDiv({ cls: "propsec-rule" });
    const input = wrap.createEl("input", {
        type: "text",
        cls: "propsec-rule-input",
        attr: { spellcheck: "false", autocomplete: "off" },
    });
    input.value = options.value;
    const example = helpersFor(options.context)[0];
    input.placeholder = `${example ? `e.g. ${expandSnippet(example.insert).text}   ` : ""}Ctrl+Space for helpers`;

    const status = wrap.createDiv({ cls: "propsec-rule-status" });
    const refresh = () => {
        status.empty();
        const value = input.value;
        const check = checkRule(value, options.context.properties);
        input.toggleClass("propsec-input-error", check.error !== null);
        if (check.error) {
            status.createDiv({ text: `${check.error.message} (at character ${check.error.at + 1})`, cls: "propsec-rule-error" });
            return;
        }
        for (const warning of check.warnings) status.createDiv({ text: warning, cls: "propsec-rule-warning" });
        if (options.preview && value.trim()) status.createDiv({ text: options.preview(value), cls: "propsec-rule-preview" });
    };
    const update = () => {
        options.onChange(input.value);
        refresh();
    };

    const suggest = new RuleSuggest(app, input, options.context, update);
    input.addEventListener("input", update);
    input.addEventListener("keydown", (evt) => {
        if (evt.ctrlKey && evt.code === "Space") {
            evt.preventDefault();
            suggest.explicit = true;
            input.dispatchEvent(new Event("input"));
        }
    });
    refresh();
    return input;
}

class RuleSuggest extends AbstractInputSuggest<Completion> {
    private range = { from: 0, to: 0 };
    explicit = false;

    constructor(
        app: App,
        private input: HTMLInputElement,
        private context: RuleContext,
        private onPick: () => void
    ) {
        super(app, input);
        this.limit = 60;
    }

    getSuggestions(): Completion[] {
        const cursor = this.input.selectionStart ?? this.input.value.length;
        const result = completeRule(this.input.value, cursor, this.context, this.explicit);
        this.explicit = false;
        this.range = { from: result.from, to: result.to };
        return result.items;
    }

    renderSuggestion(item: Completion, el: HTMLElement): void {
        el.addClass("propsec-rule-suggestion");
        el.createSpan({ text: item.label, cls: `propsec-rule-suggestion-label is-${item.kind}` });
        if (item.detail) el.createSpan({ text: item.detail, cls: "propsec-rule-suggestion-detail" });
    }

    selectSuggestion(item: Completion): void {
        const { text, select } = expandSnippet(item.insert);
        const value = this.input.value;
        this.input.value = value.slice(0, this.range.from) + text + value.slice(this.range.to);
        this.input.setSelectionRange(this.range.from + select[0], this.range.from + select[1]);
        this.input.focus();
        this.onPick();
        if (text.endsWith(".")) this.input.dispatchEvent(new Event("input"));
        else this.close();
    }
}
