import os
import json

# ── CONFIGURATION ──
# Change these to match the exact names of your 3 subfolders
subfolders = ["image_evaluation/triplet_dataset_sharp_500/baseline", "image_evaluation/triplet_dataset_sharp_500/guided", "image_evaluation/triplet_dataset_sharp_500/patched"] 
output_file = "images.json"
image_extensions = ('.png')

def generate_json():
    # Use the first folder as the "source of truth"
    folder_a_path = subfolders[0]
    
    if not os.path.exists(folder_a_path):
        print(f"Error: Folder '{folder_a_path}' not found.")
        return

    valid_files = [f for f in os.listdir(folder_a_path) if f.lower().endswith(image_extensions)]
    valid_files.sort() # Keep them in order

    dataset = []
    
    for idx, filename in enumerate(valid_files):
        # Verify the file also exists in the other two folders
        missing = False
        for folder in subfolders[1:]:
            if not os.path.exists(os.path.join(folder, filename)):
                print(f"Warning: {filename} is missing in '{folder}'. Skipping this image.")
                missing = True
                break
                
        if not missing:
            dataset.append({
                "id": str(idx + 1),
                "filename": filename,
                "prompt": "" # You can manually add prompts to the JSON later if needed
            })

    # Write out the JSON
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(dataset, f, indent=2)

    print(f"Success! Generated {output_file} containing {len(dataset)} image triples.")

if __name__ == "__main__":
    generate_json()