import AppVM from "./app-vm.ts"
import PlaygroundVM from "./pages/playground/playground-vm.ts"
import GalleryVM from "./pages/gallery/gallery-vm.ts"
import DocsVM from "./pages/docs/docs-vm.ts"

resources AppShell {
    DataTemplate [DataType = DocsVM]       { Border [ Fill = @Surface ] { TextBlock [ Margin = (24,24,24,24), FontSize = 20, Text = $Title ] } }

    DataTemplate [DataType = AppVM] {
        DockPanel {
            Border [ DockPanel.Dock = Left, Fill = @SurfaceVariant, Width = 160 ] {
                StackPanel [ Orientation = Vertical, Margin = (8,8,8,8) ] {
                    Button [ Command = $ShowPlayground, Margin = (0,0,0,4) ] { TextBlock [ Text = "Playground" ] }
                    Button [ Command = $ShowGallery,    Margin = (0,0,0,4) ] { TextBlock [ Text = "Gallery" ] }
                    Button [ Command = $ShowDocs ]                          { TextBlock [ Text = "Docs" ] }
                }
            }
            ContentControl [ Content = $ActivePage ]
        }
    }
}
