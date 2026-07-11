import { removeSavedConfig, sanitizeSavedConfigs, upsertSavedConfig } from "../shared/saved-configs.js";
import type { ReservationConfig, SavedConfig, SavedConfigList } from "../shared/types.js";

interface StorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
}

const STORAGE_KEY: Record<SavedConfigList, "configHistory" | "configFavorites"> = {
  history: "configHistory",
  favorites: "configFavorites",
};

export class SavedConfigRepository {
  constructor(
    private readonly storage: StorageArea,
    private readonly createId: () => string,
    private readonly now: () => number,
  ) {}

  async upsert(list: SavedConfigList, config: ReservationConfig): Promise<SavedConfig[]> {
    return this.update(list, (items) => upsertSavedConfig(items, config, {
      id: this.createId(),
      savedAt: this.now(),
    }));
  }

  async remove(list: SavedConfigList, id: string): Promise<SavedConfig[]> {
    return this.update(list, (items) => removeSavedConfig(items, id));
  }

  async clear(list: SavedConfigList): Promise<SavedConfig[]> {
    return this.update(list, () => []);
  }

  private async update(
    list: SavedConfigList,
    operation: (items: SavedConfig[]) => SavedConfig[],
  ): Promise<SavedConfig[]> {
    const key = STORAGE_KEY[list];
    const stored = await this.storage.get(key);
    const next = operation(sanitizeSavedConfigs(stored[key]));
    await this.storage.set({ [key]: next });
    return next;
  }
}
