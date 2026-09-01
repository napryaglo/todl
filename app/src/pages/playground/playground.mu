import PlaygroundVM from "./playground-vm.ts"

resources Playground {
    DataTemplate [DataType = PlaygroundVM] {
        DockPanel {
            DockPanel [ DockPanel.Dock = Top, Margin = (8,8,8,4) ] {
                TextBlock [ DockPanel.Dock = Left, Margin = (0,4,8,0), Text = "Example:" ]
                ComboBox  [ Width = 320, Items = $Refs, SelectedItem = $Selected ]
            }
            ContentControl [ Content = $Runner ]
        }
    }
}
