/**
 * CategoryManager — a full-screen dialog that lets users view, create, edit,
 * and delete their custom measurement categories.
 *
 * Each category has a measurementType that determines which drawing mode is
 * activated when the category is selected in the canvas toolbar:
 *   area   → polygon drawing (sq ft)
 *   linear → polyline drawing (linear ft)
 *   count  → point counting (item count)
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Loader2, Pencil, Trash2, Plus, Check, X } from "lucide-react";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type MeasurementType = "area" | "linear" | "count";

interface CategoryManagerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const TYPE_LABELS: Record<MeasurementType, string> = {
  area: "Area (sq ft)",
  linear: "Linear Ft",
  count: "Count",
};

const TYPE_COLORS: Record<MeasurementType, string> = {
  area: "bg-blue-100 text-blue-800 border-blue-200",
  linear: "bg-green-100 text-green-800 border-green-200",
  count: "bg-orange-100 text-orange-800 border-orange-200",
};

// Built-in preset categories shown for reference (read-only)
const PRESET_CATEGORIES: Array<{ name: string; measurementType: MeasurementType }> = [
  { name: "Drip Edge",     measurementType: "linear" },
  { name: "Walk Pads",     measurementType: "area"   },
  { name: "Coping",        measurementType: "linear" },
  { name: "Gutter",        measurementType: "linear" },
  { name: "Roofing Field", measurementType: "area"   },
  { name: "Wall",          measurementType: "area"   },
  { name: "Curbs",         measurementType: "count"  },
  { name: "Pipes",         measurementType: "count"  },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function CategoryManager({ open, onOpenChange }: CategoryManagerProps) {
  const utils = trpc.useUtils();

  // Remote data
  const { data: categories = [], isLoading } = trpc.countingCategories.list.useQuery(
    undefined,
    { enabled: open }
  );
  const createMutation = trpc.countingCategories.create.useMutation({
    onSuccess: () => utils.countingCategories.list.invalidate(),
  });
  const updateMutation = trpc.countingCategories.update.useMutation({
    onSuccess: () => utils.countingCategories.list.invalidate(),
  });
  const deleteMutation = trpc.countingCategories.delete.useMutation({
    onSuccess: () => utils.countingCategories.list.invalidate(),
  });

  // New category form
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<MeasurementType>("area");

  // Inline edit state
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editType, setEditType] = useState<MeasurementType>("area");

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------
  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) {
      toast.error("Please enter a category name");
      return;
    }
    try {
      await createMutation.mutateAsync({ name, measurementType: newType });
      setNewName("");
      setNewType("area");
      toast.success(`Category "${name}" created`);
    } catch {
      toast.error("Failed to create category");
    }
  };

  const startEdit = (cat: { id: number; name: string; measurementType: MeasurementType }) => {
    setEditingId(cat.id);
    setEditName(cat.name);
    setEditType(cat.measurementType);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName("");
  };

  const handleUpdate = async (id: number) => {
    const name = editName.trim();
    if (!name) {
      toast.error("Category name cannot be empty");
      return;
    }
    try {
      await updateMutation.mutateAsync({ id, name, measurementType: editType });
      setEditingId(null);
      toast.success("Category updated");
    } catch {
      toast.error("Failed to update category");
    }
  };

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(`Delete category "${name}"? This won't affect existing measurements.`)) return;
    try {
      await deleteMutation.mutateAsync({ id });
      toast.success(`Category "${name}" deleted`);
    } catch {
      toast.error("Failed to delete category");
    }
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Manage Categories</DialogTitle>
          <DialogDescription>
            Create and organize your measurement categories. Each category type determines
            which drawing mode is activated when you select it.
          </DialogDescription>
        </DialogHeader>

        {/* Legend */}
        <div className="flex gap-2 flex-wrap text-xs">
          {(Object.entries(TYPE_LABELS) as [MeasurementType, string][]).map(([type, label]) => (
            <span key={type} className={`px-2 py-0.5 rounded-full border font-medium ${TYPE_COLORS[type]}`}>
              {label}
            </span>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto space-y-6 pr-1">
          {/* ----------------------------------------------------------------
              Built-in preset categories (read-only reference)
          ---------------------------------------------------------------- */}
          <section>
            <h3 className="text-sm font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
              Built-in Categories
            </h3>
            <div className="rounded-md border divide-y">
              {PRESET_CATEGORIES.map((cat) => (
                <div key={cat.name} className="flex items-center justify-between px-3 py-2">
                  <span className="text-sm font-medium">{cat.name}</span>
                  <Badge
                    variant="outline"
                    className={`text-xs ${TYPE_COLORS[cat.measurementType]}`}
                  >
                    {TYPE_LABELS[cat.measurementType]}
                  </Badge>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Built-in categories cannot be edited or deleted.
            </p>
          </section>

          {/* ----------------------------------------------------------------
              User's custom categories
          ---------------------------------------------------------------- */}
          <section>
            <h3 className="text-sm font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
              My Categories
            </h3>

            {isLoading ? (
              <div className="flex items-center justify-center py-6 text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                Loading…
              </div>
            ) : categories.length === 0 ? (
              <div className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
                No custom categories yet. Create one below.
              </div>
            ) : (
              <div className="rounded-md border divide-y">
                {categories.map((cat) => (
                  <div key={cat.id} className="px-3 py-2">
                    {editingId === cat.id ? (
                      /* Inline edit row */
                      <div className="flex items-center gap-2">
                        <Input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="h-8 flex-1"
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleUpdate(cat.id);
                            if (e.key === "Escape") cancelEdit();
                          }}
                          autoFocus
                        />
                        <Select
                          value={editType}
                          onValueChange={(v) => setEditType(v as MeasurementType)}
                        >
                          <SelectTrigger className="h-8 w-36">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="area">Area (sq ft)</SelectItem>
                            <SelectItem value="linear">Linear Ft</SelectItem>
                            <SelectItem value="count">Count</SelectItem>
                          </SelectContent>
                        </Select>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-green-600 hover:text-green-700"
                          onClick={() => handleUpdate(cat.id)}
                          disabled={updateMutation.isPending}
                          aria-label="Save changes"
                        >
                          {updateMutation.isPending ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Check className="w-4 h-4" />
                          )}
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          onClick={cancelEdit}
                          aria-label="Cancel edit"
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    ) : (
                      /* Display row */
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">{cat.name}</span>
                        <div className="flex items-center gap-2">
                          <Badge
                            variant="outline"
                            className={`text-xs ${TYPE_COLORS[cat.measurementType as MeasurementType]}`}
                          >
                            {TYPE_LABELS[cat.measurementType as MeasurementType]}
                          </Badge>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={() => startEdit({ id: cat.id, name: cat.name, measurementType: cat.measurementType as MeasurementType })}
                            aria-label={`Edit ${cat.name}`}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-destructive hover:text-destructive"
                            onClick={() => handleDelete(cat.id, cat.name)}
                            disabled={deleteMutation.isPending}
                            aria-label={`Delete ${cat.name}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* ----------------------------------------------------------------
            Create new category form (pinned at bottom)
        ---------------------------------------------------------------- */}
        <div className="border-t pt-4 space-y-3">
          <h3 className="text-sm font-semibold">Add New Category</h3>
          <div className="flex gap-2">
            <div className="flex-1 space-y-1">
              <Label htmlFor="new-cat-name" className="sr-only">Category Name</Label>
              <Input
                id="new-cat-name"
                placeholder="Category name (e.g. Skylights, Flashing)"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                className="h-9"
              />
            </div>
            <div className="w-40">
              <Label htmlFor="new-cat-type" className="sr-only">Measurement Type</Label>
              <Select value={newType} onValueChange={(v) => setNewType(v as MeasurementType)}>
                <SelectTrigger id="new-cat-type" className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="area">Area (sq ft)</SelectItem>
                  <SelectItem value="linear">Linear Ft</SelectItem>
                  <SelectItem value="count">Count</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              onClick={handleCreate}
              disabled={createMutation.isPending || !newName.trim()}
              className="h-9"
            >
              {createMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Plus className="w-4 h-4" />
              )}
              <span className="ml-1">Add</span>
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            The measurement type determines which drawing mode activates when you select this category:
            <strong> Area</strong> draws polygons, <strong>Linear Ft</strong> draws lines,
            and <strong>Count</strong> places point markers.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
