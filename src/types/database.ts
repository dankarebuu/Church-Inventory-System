export type UserRole = 'guest' | 'member' | 'admin';

export type ItemCondition = 'working' | 'repair' | 'missing';

export type HistoryAction =
  | 'added'
  | 'updated'
  | 'checked'
  | 'deleted'
  | 'restored'
  | 'import'
  | 'loan';

export type InventoryItem = {
  id: string;
  category: string;
  category_id: string | null;
  subcategory_id: string | null;
  item: string;
  brand: string | null;
  qty: number;
  condition: ItemCondition;
  owner: string | null;
  location: string | null;
  location_id: string | null;
  checkedBy: string | null;
  dateChecked: string | null;
  checked_at: string | null;
  updated_at: string | null;
  remarks: string | null;
  borrower: string | null;
  returnDate: string | null;
  serial: string | null;
  description: string | null;
  image_filename: string | null;
  deleted_at: string | null;
};

export type PublicInventoryItem = {
  id: string;
  category: string;
  category_id: string | null;
  subcategory_id: string | null;
  item: string;
  brand: string | null;
  qty: number;
  condition: ItemCondition;
  owner: string | null;
  location: string | null;
  location_id: string | null;
  serial: string | null;
  description: string | null;
  image_filename: string | null;
  remarks: string | null;
  dateChecked: string | null;
  checked_at: string | null;
  qty_on_loan: number;
  available_qty: number;
};

export type Category = {
  id: string;
  name: string;
  parent_id: string | null;
  color: string;
  icon: string | null;
  sort_order: number;
  created_at: string;
};

export type LocationRecord = {
  id: string;
  name: string;
  description: string | null;
  sort_order: number;
  created_at: string;
};

export type LoanRecord = {
  id: string;
  item_id: string;
  borrower_name: string;
  borrower_contact: string | null;
  qty_loaned: number;
  checked_out_at: string;
  due_date: string | null;
  returned_at: string | null;
  checked_out_by: string | null;
  returned_by: string | null;
  notes: string | null;
};

export type ImportHistoryPayload = {
  insertedIds: string[];
  updatedItems: Array<{
    id: string;
    prev_data: Partial<InventoryItem>;
  }>;
};

export type LoanHistoryPayload = {
  actionType?: 'checkout' | 'return';
  item_id: string;
  item?: string;
  loan_id?: string;
  borrower_name?: string;
  qty_loaned?: number;
  due_date?: string | null;
  returned_at?: string | null;
  notes?: string | null;
};

export type HistoryItemData =
  | InventoryItem
  | Partial<InventoryItem>
  | ImportHistoryPayload
  | LoanHistoryPayload
  | Record<string, unknown>;

export type HistoryEntry = {
  id: string;
  action: HistoryAction;
  item_id: string | null;
  item_data: HistoryItemData | null;
  prev_data: Partial<InventoryItem> | Record<string, unknown> | null;
  user_email: string;
  undone: boolean;
  timestamp: string;
};

export type ProfileRecord = {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  role: 'member' | 'admin';
  created_at: string;
};

export type MemberCheckItemResult = {
  id: string;
  condition: ItemCondition;
  checkedBy: string | null;
  dateChecked: string | null;
  checked_at: string | null;
  remarks: string | null;
  action: 'checked' | 'updated';
};

export type Database = {
  public: {
    Tables: {
      inventory: {
        Row: InventoryItem;
        Insert: Partial<InventoryItem> & Pick<InventoryItem, 'id' | 'item' | 'category'>;
        Update: Partial<InventoryItem>;
        Relationships: [];
      };
      categories: {
        Row: Category;
        Insert: {
          id?: string;
          name: string;
          parent_id?: string | null;
          color?: string;
          icon?: string | null;
          sort_order?: number;
          created_at?: string;
        };
        Update: Partial<Category>;
        Relationships: [];
      };
      locations: {
        Row: LocationRecord;
        Insert: {
          id?: string;
          name: string;
          description?: string | null;
          sort_order?: number;
          created_at?: string;
        };
        Update: Partial<LocationRecord>;
        Relationships: [];
      };
      loans: {
        Row: LoanRecord;
        Insert: {
          id?: string;
          item_id: string;
          borrower_name: string;
          borrower_contact?: string | null;
          qty_loaned?: number;
          checked_out_at?: string;
          due_date?: string | null;
          returned_at?: string | null;
          checked_out_by?: string | null;
          returned_by?: string | null;
          notes?: string | null;
        };
        Update: Partial<LoanRecord>;
        Relationships: [];
      };
      history_log: {
        Row: HistoryEntry;
        Insert: {
          id: string;
          action: HistoryAction;
          item_id?: string | null;
          item_data?: HistoryItemData | null;
          prev_data?: Partial<InventoryItem> | Record<string, unknown> | null;
          user_email: string;
          undone?: boolean;
          timestamp?: string;
        };
        Update: Partial<HistoryEntry>;
        Relationships: [];
      };
      profiles: {
        Row: ProfileRecord;
        Insert: {
          id: string;
          email: string;
          first_name?: string | null;
          last_name?: string | null;
          role?: 'member' | 'admin';
          created_at?: string;
        };
        Update: Partial<ProfileRecord>;
        Relationships: [];
      };
    };
    Views: {
      inventory_public: {
        Row: PublicInventoryItem;
        Relationships: [];
      };
    };
    Functions: {
      member_check_item: {
        Args: {
          p_item_id: string;
          p_condition: ItemCondition;
          p_remarks?: string | null;
        };
        Returns: MemberCheckItemResult;
      };
      current_user_role: {
        Args: Record<string, never>;
        Returns: UserRole;
      };
      has_other_admin: {
        Args: {
          p_excluded_id: string;
        };
        Returns: boolean;
      };
    };
  };
};
