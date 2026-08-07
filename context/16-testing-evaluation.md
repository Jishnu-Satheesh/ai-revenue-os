# Testing and Evaluation

## Four evaluation layers

### 1. Software correctness

Does the code behave correctly under normal, edge, retry, and failure conditions?

### 2. AI output quality

Is the model output valid, grounded, useful, and policy compliant?

### 3. Execution quality

Did the system perform the intended provider action exactly once and verify the result?

### 4. Business impact

Did the action cause a measurable incremental outcome without violating guardrails?

## Evaluation datasets

Maintain versioned fixtures for:

- Organization profiles.
- Menus.
- Sales histories.
- Reviews.
- Opportunity signals.
- Policy configurations.
- Historical outcomes.

## Model evaluation metrics

Depending on worker:

- Schema validity.
- Evidence citation accuracy.
- Unsupported-claim rate.
- Policy violation rate.
- Human acceptance rate.
- Edit distance from approved output.
- Cost and latency.

## Business evaluation

Every playbook defines:

- Baseline window.
- Measurement window.
- Primary metric.
- Guardrail metrics.
- Attribution method.
- Minimum evidence threshold.
- Decision rule for validated, failed, or inconclusive.

## Attribution caution

Offline footfall and third-party marketplace orders may have imperfect attribution. Use the strongest available method, such as promotion codes, tracked links, call tracking, reservation source, geographic holdouts, or matched time periods, and label limitations honestly.
