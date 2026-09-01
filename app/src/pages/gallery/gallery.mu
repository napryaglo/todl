import GalleryVM from "./gallery-vm.ts"
import GalleryCardVM from "./gallery-card-vm.ts"

resources Gallery {
    DataTemplate x:key="GalleryCardTemplate" [DataType = GalleryCardVM] {
        Border [ Fill = @SurfaceVariant, Padding = (12,10,12,10), Margin = (0,0,0,8) ] {
            DockPanel {
                TextBlock [ DockPanel.Dock = Right, FontWeight = Bold, Foreground = @Primary, Text = $Badge ]
                StackPanel [ Orientation = Vertical ] {
                    TextBlock [ FontWeight = Bold, FontSize = 14, Text = $Title ]
                    TextBlock [ FontSize = 11, Foreground = @OnSurfaceVariant, Text = $Tags ]
                }
            }
        }
    }
    DataTemplate [DataType = GalleryVM] {
        DockPanel {
            TextBlock [ DockPanel.Dock = Top, Margin = (12,12,12,8), FontSize = 18, FontWeight = Bold, Text = $Title ]
            ListBox [ Margin = (12,0,12,12), ItemsSource = $Cards, ItemTemplate = @GalleryCardTemplate, SelectedItem = $Selected ]
        }
    }
}
