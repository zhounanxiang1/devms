import { Select as AntSelect } from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import { fmtDate, label } from "../lib/format";
import { ProjectDocument } from "../types";

export function DocumentRelationSelector({
  name = "documentIds",
  label: text,
  documents,
  projectId,
  allowedTypes,
  defaultValue
}: {
  name?: string;
  label: string;
  documents: ProjectDocument[];
  projectId?: number | null;
  allowedTypes: string[];
  defaultValue?: number[];
}) {
  const allowedTypeKey = allowedTypes.join("|");
  const allowedTypeSet = useMemo(() => new Set(allowedTypes), [allowedTypeKey]);
  const projectDocumentOptions = useMemo(
    () =>
      documents
        .filter((document) => {
          const documentProjectId = document.projectId || document.project?.id;
          return Boolean(projectId && documentProjectId === projectId && allowedTypeSet.has(document.type));
        })
        .map((document) => ({
          value: document.id,
          label: `${document.name}（${label(document.type)}${document.createdBy?.name ? ` · ${document.createdBy.name}` : ""}${document.createdAt ? ` · ${fmtDate(document.createdAt)}` : ""}）`
        })),
    [allowedTypeSet, documents, projectId]
  );
  const optionIds = new Set(projectDocumentOptions.map((option) => option.value));
  const optionIdsKey = projectDocumentOptions.map((option) => option.value).join("|");
  const defaultValueKey = (defaultValue || []).join("|");
  const appliedDefaultKey = useRef("");
  const [selectedIds, setSelectedIds] = useState<number[]>((defaultValue || []).filter((id) => optionIds.has(id)));
  const allowedTypeText = allowedTypes.map((type) => label(type)).join("、");

  useEffect(() => {
    setSelectedIds((current) => current.filter((id) => optionIds.has(id)));
  }, [optionIdsKey]);

  useEffect(() => {
    if (appliedDefaultKey.current === defaultValueKey) return;
    const nextDefaultIds = (defaultValue || []).filter((id) => optionIds.has(id));
    if (!nextDefaultIds.length && defaultValue?.length && !projectDocumentOptions.length) return;
    setSelectedIds(nextDefaultIds);
    appliedDefaultKey.current = defaultValueKey;
  }, [defaultValue, defaultValueKey, optionIdsKey, projectDocumentOptions.length]);

  return (
    <label className="field document-relation-field">
      <span className="field-label">{text}</span>
      {selectedIds.map((id) => <input key={id} type="hidden" name={name} value={id} />)}
      <AntSelect
        mode="multiple"
        showSearch
        allowClear
        maxTagCount="responsive"
        optionFilterProp="label"
        disabled={!projectId}
        value={selectedIds}
        options={projectDocumentOptions}
        placeholder={projectId ? `选择当前项目下的${allowedTypeText}` : "请先选择所属项目"}
        onChange={(values) => setSelectedIds(values.map(Number).filter(Number.isFinite))}
        notFoundContent={projectId ? "当前项目暂无可关联资料" : "请先选择所属项目"}
      />
      <span className="field-help">仅可关联当前项目资料库中的{allowedTypeText}；如没有可选资料，请先到“资料”页新增。</span>
    </label>
  );
}
