import { Fragment, memo } from "react";
import {
  groupedModels,
  modelBillingSuffix,
  modelLabel,
} from "../shared/model-picker.ts";
import { modelKey } from "../shared/settings.ts";
import type { ModelInfo } from "../shared/types.ts";

// Native groups keep platform keyboard navigation and mobile pickers. Modern
// select controls render <hr> as a nonselectable horizontal separator; group
// labels still distinguish sections on platforms that omit the rule.
export const ModelOptions = memo(function ModelOptions({
  models,
  keyFor = modelKey,
  billing = false,
}: {
  models: readonly ModelInfo[];
  keyFor?: (model: ModelInfo) => string;
  billing?: boolean;
}) {
  return groupedModels(models).map((group, index) => (
    <Fragment key={group.id}>
      {index > 0 && <hr aria-hidden="true" />}
      <optgroup label={group.label}>
        {group.models.map((model) => (
          <option key={keyFor(model)} value={keyFor(model)}>
            {modelLabel(model)}
            {billing ? modelBillingSuffix(model) : ""}
          </option>
        ))}
      </optgroup>
    </Fragment>
  ));
});
