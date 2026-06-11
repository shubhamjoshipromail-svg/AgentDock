"use client";

import { flow } from "../mock-data";

export function RouteView() {
  return (
    <div className="flowDiagram">
      {flow.map((item, index) => (
        <div className="flowNodeWrap" key={item}>
          <div className="flowNode"><span>{index + 1}</span><strong>{item}</strong></div>
          {index < flow.length - 1 && <div className="connector" aria-hidden="true" />}
        </div>
      ))}
    </div>
  );
}
